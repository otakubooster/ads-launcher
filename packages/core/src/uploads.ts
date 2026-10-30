import { adAccounts, creativeUploads, creatives } from "@fahd/db/schema";
import { MetaApiError, describeMetaError, type MetaClient } from "@fahd/meta";
import { and, eq, ne, sql } from "drizzle-orm";
import { clientForAdAccount } from "./meta-client";
import type { Storage } from "./storage";
import type { AnyDb } from "./types";

export type UploadOptions = {
  client?: MetaClient;
  sleep?: (ms: number) => Promise<void>;
  /** Poll interval for video processing (spec: 10 s). */
  pollMs?: number;
  /** Give up on processing after this long (spec: 20 min). */
  timeoutMs?: number;
};

export type UploadResult = { status: "ready"; imageHash: string | null; videoId: string | null; thumbnailUrl: string | null; reused: boolean };

/**
 * Puts one creative into one ad account's media library (docs/spec.md → Media
 * upload): cached per account in creative_uploads, deduped by sha256, images by
 * bytes, videos by signed file_url or chunked upload, then polled until ready.
 * A video is never reported ready before Meta says so. `db` must be privileged.
 */
export async function uploadCreativeToAccount(db: AnyDb, storage: Storage, creativeId: string, adAccountId: string, opts: UploadOptions = {}): Promise<UploadResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? Number(process.env.META_VIDEO_POLL_MS ?? 10_000);
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000;

  const [creative] = await db.select().from(creatives).where(eq(creatives.id, creativeId));
  if (!creative) throw new Error("Creative not found");
  const [existing] = await db
    .select()
    .from(creativeUploads)
    .where(and(eq(creativeUploads.creativeId, creativeId), eq(creativeUploads.adAccountId, adAccountId)));
  if (existing?.status === "ready") {
    return { status: "ready", imageHash: existing.imageHash, videoId: existing.videoId, thumbnailUrl: existing.thumbnailUrl, reused: true };
  }

  const setRow = async (values: Partial<typeof creativeUploads.$inferInsert>) => {
    await db
      .insert(creativeUploads)
      .values({ creativeId, adAccountId, ...values })
      .onConflictDoUpdate({ target: [creativeUploads.creativeId, creativeUploads.adAccountId], set: { ...values, error: values.error ?? null } });
  };

  // Same bytes already in this account under another creative row: reuse them.
  const [twin] = await db
    .select({ imageHash: creativeUploads.imageHash, videoId: creativeUploads.videoId, thumbnailUrl: creativeUploads.thumbnailUrl })
    .from(creativeUploads)
    .innerJoin(creatives, eq(creatives.id, creativeUploads.creativeId))
    .where(and(eq(creativeUploads.adAccountId, adAccountId), eq(creativeUploads.status, "ready"), eq(creatives.sha256, creative.sha256), ne(creatives.id, creativeId)));
  if (twin) {
    await setRow({ status: "ready", ...twin });
    return { status: "ready", ...twin, reused: true };
  }

  const { client, metaAccountId } = opts.client
    ? { client: opts.client, metaAccountId: (await db.select({ m: adAccounts.metaId }).from(adAccounts).where(eq(adAccounts.id, adAccountId)))[0]!.m }
    : await clientForAdAccount(db, adAccountId);
  const options = { accountId: metaAccountId };

  try {
    await setRow({ status: "uploading" });
    if (creative.kind === "image") {
      const bytes = await storage.readAll(creative.storagePath);
      const form = new FormData();
      form.set("filename", new Blob([new Uint8Array(bytes)]), creative.fileName);
      const res = await client.upload<{ images: Record<string, { hash: string }> }>(`${metaAccountId}/adimages`, form, options);
      const hash = Object.values(res.images)[0]?.hash;
      if (!hash) throw new Error("Meta returned no image hash");
      await setRow({ status: "ready", imageHash: hash });
      return { status: "ready", imageHash: hash, videoId: null, thumbnailUrl: null, reused: false };
    }

    let videoId: string;
    if (storage.publicUrls) {
      const fileUrl = await storage.signedReadUrl(creative.storagePath, 3600);
      ({ id: videoId } = await client.post<{ id: string }>(`${metaAccountId}/advideos`, { file_url: fileUrl, name: creative.fileName }, options));
    } else {
      videoId = await chunkedUpload(client, storage, metaAccountId, creative.storagePath, creative.sizeBytes, creative.fileName);
    }
    await setRow({ status: "processing", videoId });

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { status } = await client.get<{ status?: { video_status?: string } }>(videoId, { fields: "status" }, options);
      if (status?.video_status === "ready") break;
      if (status?.video_status === "error") throw new Error("Meta could not process this video");
      if (Date.now() > deadline) throw new Error("Meta did not finish processing the video within 20 minutes");
      await sleep(pollMs);
    }
    const thumbs = await client.get<{ data: { uri: string; is_preferred?: boolean }[] }>(`${videoId}/thumbnails`, {}, options);
    const thumbnailUrl = (thumbs.data.find((t) => t.is_preferred) ?? thumbs.data[0])?.uri ?? null;
    await setRow({ status: "ready", videoId, thumbnailUrl });
    return { status: "ready", imageHash: null, videoId, thumbnailUrl, reused: false };
  } catch (e) {
    const message = e instanceof MetaApiError ? `${describeMetaError(e).title}: ${describeMetaError(e).detail}` : e instanceof Error ? e.message : String(e);
    await setRow({ status: "error", error: message.slice(0, 500) });
    throw e;
  }
}

/** Meta's resumable upload: start with file_size, transfer at the offsets Meta returns, finish. */
async function chunkedUpload(client: MetaClient, storage: Storage, metaAccountId: string, objectPath: string, size: number, name: string) {
  const options = { accountId: metaAccountId };
  const start = await client.post<{ upload_session_id: string; video_id: string; start_offset: string; end_offset: string }>(
    `${metaAccountId}/advideos`,
    { upload_phase: "start", file_size: size },
    options,
  );
  let from = Number(start.start_offset);
  let to = Number(start.end_offset);
  while (from < to) {
    const chunk = await storage.readRange(objectPath, from, to);
    const form = new FormData();
    form.set("upload_phase", "transfer");
    form.set("upload_session_id", start.upload_session_id);
    form.set("start_offset", String(from));
    form.set("video_file_chunk", new Blob([new Uint8Array(chunk)]), name);
    const next = await client.upload<{ start_offset: string; end_offset: string }>(`${metaAccountId}/advideos`, form, options);
    from = Number(next.start_offset);
    to = Number(next.end_offset);
  }
  await client.post(`${metaAccountId}/advideos`, { upload_phase: "finish", upload_session_id: start.upload_session_id, title: name }, options);
  return start.video_id;
}

/** Upload state per account, for the library and the launch builder. */
export async function uploadStates(db: AnyDb, creativeIds: string[]) {
  if (!creativeIds.length) return [];
  return db
    .select()
    .from(creativeUploads)
    .where(sql`${creativeUploads.creativeId} = any(${`{${creativeIds.join(",")}}`}::uuid[])`);
}
