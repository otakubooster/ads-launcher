import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";

/**
 * Creative file storage. Browsers upload straight to it through a signed URL, so
 * large files never pass through the web app; Meta fetches videos from a signed
 * read URL when the storage is public (Supabase), otherwise the worker streams
 * chunks (local disk in development).
 */
export interface Storage {
  readonly driver: "local" | "supabase" | "s3";
  /** Whether read URLs are reachable from the internet (Meta can fetch file_url). */
  readonly publicUrls: boolean;
  signedUploadUrl(objectPath: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }>;
  signedReadUrl(objectPath: string, ttlSeconds?: number): Promise<string>;
  size(objectPath: string): Promise<number | null>;
  readRange(objectPath: string, start: number, endExclusive: number): Promise<Uint8Array>;
  readAll(objectPath: string): Promise<Uint8Array>;
  remove(objectPaths: string[]): Promise<void>;
}

export const CREATIVES_BUCKET = "creatives";

// --- Local disk ---------------------------------------------------------------

function signingKey() {
  const k = process.env.STORAGE_SIGNING_KEY ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY (or STORAGE_SIGNING_KEY) is not set");
  return createHmac("sha256", k).update("local-storage").digest();
}

export function signLocal(op: "read" | "write", objectPath: string, exp: number) {
  return createHmac("sha256", signingKey()).update(`${op}:${objectPath}:${exp}`).digest("base64url");
}

/** For the /api/files route: checks the signature and expiry of a local storage URL. */
export function verifyLocal(op: "read" | "write", objectPath: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(signLocal(op, objectPath, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function localRoot() {
  return process.env.STORAGE_DIR ?? path.join(tmpdir(), "fahd-storage");
}

/** Resolves an object path inside the storage root, refusing traversal. */
export function localFile(objectPath: string) {
  // Runtime-only path (STORAGE_DIR); keep the bundler from tracing the whole project.
  const root = path.resolve(/*turbopackIgnore: true*/ localRoot());
  const full = path.resolve(root, objectPath);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage path");
  return full;
}

export async function writeLocal(objectPath: string, body: ReadableStream<Uint8Array>) {
  const full = localFile(objectPath);
  await mkdir(path.dirname(full), { recursive: true });
  await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), createWriteStream(full));
}

export function readLocalStream(objectPath: string) {
  return createReadStream(localFile(objectPath));
}

class LocalStorage implements Storage {
  readonly driver = "local" as const;
  readonly publicUrls = false;
  private readonly baseUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  private url(op: "read" | "write", objectPath: string, ttl: number) {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/api/files/${encoded}?op=${op}&exp=${exp}&sig=${signLocal(op, objectPath, exp)}`;
  }
  async signedUploadUrl(objectPath: string, contentType: string) {
    return { url: this.url("write", objectPath, 3600), headers: { "content-type": contentType } };
  }
  async signedReadUrl(objectPath: string, ttlSeconds = 3600) {
    return this.url("read", objectPath, ttlSeconds);
  }
  async size(objectPath: string) {
    try {
      return (await stat(localFile(objectPath))).size;
    } catch {
      return null;
    }
  }
  async readRange(objectPath: string, start: number, endExclusive: number) {
    const handle = await open(localFile(objectPath), "r");
    try {
      const buffer = Buffer.alloc(endExclusive - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  async readAll(objectPath: string) {
    const size = (await this.size(objectPath)) ?? 0;
    return this.readRange(objectPath, 0, size);
  }
  async remove(objectPaths: string[]) {
    await Promise.all(objectPaths.map((p) => rm(localFile(p), { force: true })));
  }
}

// --- Supabase Storage ---------------------------------------------------------

class SupabaseStorage implements Storage {
  readonly driver = "supabase" as const;
  readonly publicUrls = true;
  private readonly bucket = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }).storage.from(CREATIVES_BUCKET);

  async signedUploadUrl(objectPath: string, contentType: string) {
    const { data, error } = await this.bucket.createSignedUploadUrl(objectPath, { upsert: true });
    if (error || !data) throw new Error(`Could not create an upload URL: ${error?.message}`);
    return { url: data.signedUrl, headers: { "content-type": contentType } };
  }
  async signedReadUrl(objectPath: string, ttlSeconds = 3600) {
    const { data, error } = await this.bucket.createSignedUrl(objectPath, ttlSeconds);
    if (error || !data) throw new Error(`Could not sign ${objectPath}: ${error?.message}`);
    return data.signedUrl;
  }
  async size(objectPath: string) {
    const res = await fetch(await this.signedReadUrl(objectPath, 60), { method: "HEAD" });
    return res.ok ? Number(res.headers.get("content-length")) : null;
  }
  async readRange(objectPath: string, start: number, endExclusive: number) {
    const res = await fetch(await this.signedReadUrl(objectPath, 600), { headers: { range: `bytes=${start}-${endExclusive - 1}` } });
    if (!res.ok) throw new Error(`Storage read failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async readAll(objectPath: string) {
    const res = await fetch(await this.signedReadUrl(objectPath, 600));
    if (!res.ok) throw new Error(`Storage read failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async remove(objectPaths: string[]) {
    if (objectPaths.length) await this.bucket.remove(objectPaths);
  }
}

// --- S3-compatible (Cloudflare R2, AWS S3) -------------------------------------

const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/**
 * AWS Signature V4 query-string presigning (what R2 and S3 accept for browser
 * uploads and for Meta's file_url). Only `host` is signed and the payload is
 * unsigned, so the browser can send any body and content type.
 */
export function presignS3(input: {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  host: string;
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expiresSeconds: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(input.expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ]
    .map(([k, v]) => `${rfc3986(k!)}=${rfc3986(v!)}`)
    .sort()
    .join("&");
  const canonical = [input.method, input.path, query, `host:${input.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), "s3"), "aws4_request");
  return `https://${input.host}${input.path}?${query}&X-Amz-Signature=${createHmac("sha256", key).update(toSign).digest("hex")}`;
}

class S3Storage implements Storage {
  readonly driver = "s3" as const;
  readonly publicUrls = true;
  private readonly endpoint = new URL(process.env.S3_ENDPOINT ?? "");
  private readonly bucket = process.env.S3_BUCKET ?? CREATIVES_BUCKET;

  private url(method: "GET" | "PUT" | "HEAD" | "DELETE", objectPath: string, ttl: number) {
    const key = objectPath.split("/").map(rfc3986).join("/");
    return presignS3({
      method,
      host: this.endpoint.host,
      // Path-style (/bucket/key) works on R2 and S3 alike.
      path: `/${rfc3986(this.bucket)}/${key}`,
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      region: process.env.S3_REGION ?? "auto",
      expiresSeconds: ttl,
    });
  }
  async signedUploadUrl(objectPath: string, contentType: string) {
    return { url: this.url("PUT", objectPath, 3600), headers: { "content-type": contentType } };
  }
  async signedReadUrl(objectPath: string, ttlSeconds = 3600) {
    return this.url("GET", objectPath, ttlSeconds);
  }
  async size(objectPath: string) {
    const res = await fetch(this.url("HEAD", objectPath, 60), { method: "HEAD" });
    return res.ok ? Number(res.headers.get("content-length")) : null;
  }
  async readRange(objectPath: string, start: number, endExclusive: number) {
    const res = await fetch(this.url("GET", objectPath, 600), { headers: { range: `bytes=${start}-${endExclusive - 1}` } });
    if (!res.ok) throw new Error(`Storage read failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async readAll(objectPath: string) {
    const res = await fetch(this.url("GET", objectPath, 600));
    if (!res.ok) throw new Error(`Storage read failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async remove(objectPaths: string[]) {
    await Promise.all(objectPaths.map((p) => fetch(this.url("DELETE", p, 60), { method: "DELETE" })));
  }
}

let cached: Storage | undefined;

/** STORAGE_DRIVER=local|supabase|s3; defaults to Supabase when it's configured. */
export function storageFromEnv(): Storage {
  if (cached) return cached;
  const supabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const driver = process.env.STORAGE_DRIVER ?? (supabase ? "supabase" : "local");
  cached = driver === "s3" ? new S3Storage() : driver === "supabase" ? new SupabaseStorage() : new LocalStorage();
  return cached;
}
