"use server";

import { randomUUID } from "node:crypto";
import { storageFromEnv, uploadCreativeToAccount } from "@fahd/core";
import { brands, creatives } from "@fahd/db/schema";
import { groupKey, ratioOf, validateCreative } from "@fahd/shared";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/server/action-result";
import { requireRole } from "@/lib/server/auth";
import { asUser, getDb } from "@/lib/server/db";
import { getQueues } from "@/lib/server/queue";

const EDITORS = ["owner", "admin", "buyer"] as const;

const fileInput = z.object({
  brandId: z.uuid(),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().regex(/^(image|video)\//, "Only images and videos can be uploaded."),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  kind: z.enum(["image", "video"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationS: z.number().nonnegative().nullable(),
  hasPoster: z.boolean(),
});
export type FileInput = z.infer<typeof fileInput>;

export type PreparedUpload =
  | { duplicateOf: string }
  | { id: string; storagePath: string; upload: { url: string; headers: Record<string, string> }; poster: { path: string; url: string; headers: Record<string, string> } | null };

const safeName = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(-120);

/** Validates, dedupes by sha256 within the brand, and returns signed upload URLs. */
export async function prepareUpload(input: FileInput): Promise<ActionResult<PreparedUpload>> {
  return runAction<PreparedUpload>(async () => {
    const session = await requireRole(...EDITORS);
    const f = fileInput.parse(input);
    const errors = validateCreative(f).filter((i) => i.level === "error");
    if (errors.length) return { ok: false, error: { title: "Can't upload this file", detail: errors.map((e) => e.message).join(" ") } };
    const existing = await asUser(session.userId, async (tx) => {
      const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, f.brandId));
      if (!brand) throw new Error("Brand not found");
      const [dup] = await tx.select({ id: creatives.id }).from(creatives).where(and(eq(creatives.brandId, f.brandId), eq(creatives.sha256, f.sha256)));
      return dup;
    });
    if (existing) return { ok: true, data: { duplicateOf: existing.id } };

    const storage = storageFromEnv();
    const id = randomUUID();
    const storagePath = `creatives/${f.brandId}/${id}/${safeName(f.fileName)}`;
    const upload = await storage.signedUploadUrl(storagePath, f.contentType);
    const posterPath = `creatives/${f.brandId}/${id}/poster.jpg`;
    const poster = f.hasPoster ? { path: posterPath, ...(await storage.signedUploadUrl(posterPath, "image/jpeg")) } : null;
    return { ok: true, data: { id, storagePath, upload, poster } };
  });
}

/** Records the creative once its bytes are in storage. */
export async function finishUpload(input: FileInput & { id: string; storagePath: string; posterPath: string | null }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const f = fileInput.extend({ id: z.uuid(), storagePath: z.string(), posterPath: z.string().nullable() }).parse(input);
    if (!f.storagePath.startsWith(`creatives/${f.brandId}/${f.id}/`)) throw new Error("Unexpected storage path");
    const stored = await storageFromEnv().size(f.storagePath);
    if (stored !== f.sizeBytes) {
      return { ok: false, error: { title: "Upload incomplete", detail: `Storage has ${stored ?? 0} of ${f.sizeBytes} bytes.`, fix: "Upload the file again." } };
    }
    await asUser(session.userId, (tx) =>
      tx.insert(creatives).values({
        id: f.id,
        brandId: f.brandId,
        fileName: f.fileName,
        storagePath: f.storagePath,
        kind: f.kind,
        width: f.width,
        height: f.height,
        ratio: ratioOf(f.width, f.height),
        durationS: f.durationS,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
        thumbnailPath: f.posterPath,
        groupKey: groupKey(f.fileName),
        tags: {},
      }),
    );
    revalidatePath("/creatives");
    return { ok: true, data: { id: f.id } };
  });
}

const tagsInput = z.object({
  angle: z.string().trim().max(40).optional(),
  hook: z.string().trim().max(40).optional(),
  format: z.string().trim().max(40).optional(),
  language: z.string().trim().max(10).optional(),
});

export async function updateTags(creativeIds: string[], tags: z.infer<typeof tagsInput>): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const ids = z.array(z.uuid()).min(1).parse(creativeIds);
    const clean = Object.fromEntries(Object.entries(tagsInput.parse(tags)).filter(([, v]) => v));
    await asUser(session.userId, (tx) => tx.update(creatives).set({ tags: clean }).where(inArray(creatives.id, ids)));
    revalidatePath("/creatives");
    return { ok: true, message: "Tags saved." };
  });
}

export async function deleteCreatives(creativeIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const ids = z.array(z.uuid()).min(1).parse(creativeIds);
    const removed = await asUser(session.userId, (tx) =>
      tx.delete(creatives).where(inArray(creatives.id, ids)).returning({ path: creatives.storagePath, poster: creatives.thumbnailPath }),
    );
    await storageFromEnv().remove(removed.flatMap((r) => [r.path, r.poster].filter((p): p is string => Boolean(p))));
    revalidatePath("/creatives");
    return { ok: true, message: `Deleted ${removed.length} ${removed.length === 1 ? "file" : "files"}.` };
  });
}

/** Puts creatives into ad accounts' media libraries: queued for the worker, inline without Redis. */
export async function uploadToAccounts(creativeIds: string[], adAccountIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole(...EDITORS);
    const input = z.object({ creatives: z.array(z.uuid()).min(1).max(100), accounts: z.array(z.uuid()).min(1).max(20) }).parse({ creatives: creativeIds, accounts: adAccountIds });
    const queues = getQueues();
    if (queues) {
      for (const a of input.accounts) for (const c of input.creatives) await queues.add({ kind: "upload", adAccountId: a, creativeId: c }, c);
      return { ok: true, message: `Queued ${input.creatives.length * input.accounts.length} uploads to Meta.` };
    }
    // No worker (Vercel): send everything, but don't wait for Meta to process videos;
    // the launch (or the next press) picks them up when they're ready.
    let processing = 0;
    for (const a of input.accounts) {
      for (const c of input.creatives) {
        if ((await uploadCreativeToAccount(getDb(), storageFromEnv(), c, a, { noWait: true })).status === "processing") processing++;
      }
    }
    revalidatePath("/creatives");
    const total = input.creatives.length * input.accounts.length;
    return { ok: true, message: processing ? `Sent to Meta: ${total - processing} ready, ${processing} still processing.` : `Uploaded to Meta: ${total} ready.` };
  });
}
