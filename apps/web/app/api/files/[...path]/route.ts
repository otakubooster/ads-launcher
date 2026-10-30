import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { localFile, storageFromEnv, verifyLocal, writeLocal } from "@fahd/core";

/**
 * Local-disk storage endpoint (STORAGE_DRIVER=local, development and tests):
 * signed PUT for browser uploads, signed GET for previews. Supabase serves both in production.
 */
type Ctx = { params: Promise<{ path: string[] }> };

async function check(req: Request, ctx: Ctx, op: "read" | "write") {
  if (storageFromEnv().driver !== "local") return { error: new Response("Not found", { status: 404 }) };
  const objectPath = (await ctx.params).path.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const ok = url.searchParams.get("op") === op && verifyLocal(op, objectPath, Number(url.searchParams.get("exp")), url.searchParams.get("sig") ?? "");
  return ok ? { objectPath } : { error: new Response("Link expired or invalid", { status: 403 }) };
}

const TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export async function GET(req: Request, ctx: Ctx) {
  const r = await check(req, ctx, "read");
  if ("error" in r) return r.error;
  let size: number;
  try {
    ({ size } = await stat(localFile(r.objectPath)));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[r.objectPath.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : size - 1;
  const body = Readable.toWeb(createReadStream(localFile(r.objectPath), { start, end })) as ReadableStream;
  const headers: Record<string, string> = { "content-type": type, "content-length": String(end - start + 1), "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

export async function PUT(req: Request, ctx: Ctx) {
  const r = await check(req, ctx, "write");
  if ("error" in r) return r.error;
  if (!req.body) return new Response("Empty body", { status: 400 });
  await writeLocal(r.objectPath, req.body);
  return new Response(null, { status: 204 });
}
