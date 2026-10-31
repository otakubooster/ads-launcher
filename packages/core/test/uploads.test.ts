import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { adAccounts, brands, creativeUploads, creatives, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storageFromEnv, syncConnectionAssets, uploadCreativeToAccount, type UploadResult } from "../src";

/** Tests below wait for processing, so results are always ready. */
const up = async (...args: Parameters<typeof uploadCreativeToAccount>) => (await uploadCreativeToAccount(...args)) as Extract<UploadResult, { status: "ready" }>;
const fake = createFakeGraph();
let db: Awaited<ReturnType<typeof createTestDb>>;
let accountId: string;
let brandId: string;
const MB = 1024 * 1024;

async function addCreative(fileName: string, kind: "image" | "video", bytes: Buffer, sha = randomBytes(32).toString("hex")) {
  const storagePath = `creatives/test/${randomBytes(4).toString("hex")}/${fileName}`;
  const full = path.join(process.env.STORAGE_DIR!, storagePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  const [row] = await db
    .insert(creatives)
    .values({ brandId, fileName, storagePath, kind, width: 1080, height: 1920, ratio: "9:16", sizeBytes: bytes.length, sha256: sha, groupKey: fileName.split("_")[0]!, durationS: kind === "video" ? 15 : null })
    .returning();
  return row!;
}

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  process.env.META_APP_SECRET = "s";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "fahd-store-"));
  db = await createTestDb({ minimal: true });
  const enc = encryptToken("EAAFAKEupload-tests-token-00000");
  const [conn] = await db
    .insert(metaConnections)
    .values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 })
    .returning({ id: metaConnections.id });
  await syncConnectionAssets(db, conn!.id);
  accountId = (await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000001")))[0]!.id;
  brandId = (await db.select().from(brands).limit(1))[0]!.id;
});
afterAll(() => fake.close());

const fast = { pollMs: 1, sleep: async () => {} };

describe("uploadCreativeToAccount", () => {
  it("uploads image bytes, stores the hash and reuses it next time", async () => {
    const c = await addCreative("hero_4x5.jpg", "image", randomBytes(200_000));
    const first = await up(db, storageFromEnv(), c.id, accountId, fast);
    expect(first).toMatchObject({ status: "ready", reused: false });
    expect(first.imageHash).toMatch(/^[0-9a-f]{32}$/);
    expect(await uploadCreativeToAccount(db, storageFromEnv(), c.id, accountId, fast)).toMatchObject({ reused: true, imageHash: first.imageHash });
  });

  it("streams a large video in Meta's chunks, waits for processing and keeps the thumbnail", async () => {
    const c = await addCreative("hook3_9x16.mp4", "video", Buffer.alloc(120 * MB, 7));
    const res = await up(db, storageFromEnv(), c.id, accountId, fast);
    expect(res.status).toBe("ready");
    expect(res.thumbnailUrl).toMatch(/^data:image\/svg/);
    const video = fake.objects.get(res.videoId!)!;
    expect(video.received).toBe(120 * MB);
    const [row] = await db.select().from(creativeUploads).where(and(eq(creativeUploads.creativeId, c.id), eq(creativeUploads.adAccountId, accountId)));
    expect(row).toMatchObject({ status: "ready", videoId: res.videoId });
  }, 60_000);

  it("without waiting, reports a video as processing and finishes it on the next call", async () => {
    const c = await addCreative("hook4_9x16.mp4", "video", Buffer.alloc(2 * MB, 3));
    const first = await uploadCreativeToAccount(db, storageFromEnv(), c.id, accountId, { ...fast, noWait: true });
    expect(first.status).toBe("processing");
    const second = await uploadCreativeToAccount(db, storageFromEnv(), c.id, accountId, { ...fast, noWait: true });
    expect(second).toMatchObject({ status: "ready", reused: false });
  });

  it("re-checks a ready video saved without a thumbnail instead of using it", async () => {
    const c = await addCreative("hook5_9x16.mp4", "video", Buffer.alloc(1 * MB, 5));
    const first = await up(db, storageFromEnv(), c.id, accountId, fast);
    // An older row: ready, but Meta hadn't made thumbnails yet.
    await db.update(creativeUploads).set({ thumbnailUrl: null }).where(and(eq(creativeUploads.creativeId, c.id), eq(creativeUploads.adAccountId, accountId)));
    const again = await up(db, storageFromEnv(), c.id, accountId, fast);
    expect(again).toMatchObject({ status: "ready", videoId: first.videoId, reused: false });
    expect(again.thumbnailUrl).toMatch(/^data:image\/svg/);
  });

  it("dedupes identical bytes by sha256 within an account", async () => {
    const sha = randomBytes(32).toString("hex");
    const a = await addCreative("dup_9x16.jpg", "image", randomBytes(1000), sha);
    const first = await up(db, storageFromEnv(), a.id, accountId, fast);
    const [b] = await db.insert(creatives).values({ ...a, id: undefined, storagePath: `${a.storagePath}.copy`, brandId: (await db.select().from(brands))[1]!.id }).returning();
    const second = await up(db, storageFromEnv(), b!.id, accountId, fast);
    expect(second).toMatchObject({ reused: true, imageHash: first.imageHash });
  });

  it("records Meta's error on the upload row", async () => {
    const c = await addCreative("bad_4x5.jpg", "image", randomBytes(500));
    await fetch(`${process.env.META_GRAPH_HOST}/__fake/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ match: "adimages$", error: { code: 100, message: "Invalid image", error_user_title: "Image too small", error_user_msg: "Use at least 600 px." } }),
    });
    await expect(uploadCreativeToAccount(db, storageFromEnv(), c.id, accountId, fast)).rejects.toThrow();
    const [row] = await db.select().from(creativeUploads).where(eq(creativeUploads.creativeId, c.id));
    expect(row).toMatchObject({ status: "error", error: "Image too small: Use at least 600 px." });
  });
});
