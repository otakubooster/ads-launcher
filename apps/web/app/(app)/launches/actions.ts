"use server";

import { activateLaunch, resetFailedItems } from "@fahd/core";
import { launchItems, launches, presets } from "@fahd/db/schema";
import type { LaunchDraft } from "@fahd/shared/launch-plan";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/server/action-result";
import { requireRole } from "@/lib/server/auth";
import { asUser, getDb } from "@/lib/server/db";
import { assertNotKilled, guardLaunchActivation } from "@/lib/server/guard";
import { kickLaunch } from "@/lib/server/launch-runner";
import { getQueues } from "@/lib/server/queue";

const EDITORS = ["owner", "admin", "buyer"] as const;

/** Runs (or re-runs) a launch: on the account's queue, inline without Redis. */
async function enqueue(launchId: string) {
  const [row] = await getDb()
    .select({ adAccountId: presets.adAccountId })
    .from(launches)
    .innerJoin(presets, eq(presets.id, launches.presetId))
    .where(eq(launches.id, launchId));
  const queues = getQueues();
  // A retry needs its own job id: the first run's job still holds the launch id.
  if (queues) await queues.add({ kind: "launch", adAccountId: row!.adAccountId, launchId }, `${launchId}:${Date.now()}`);
  else await kickLaunch(launchId);
}

/** "Retry failed items": only failed items go back to pending; done ones are skipped by the runner. */
export async function retryFailedItems(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole(...EDITORS);
    const launchId = z.uuid().parse(id);
    const [launch] = await getDb().select({ status: launches.status }).from(launches).where(eq(launches.id, launchId));
    if (!launch || launch.status === "draft") throw new Error("Launch not found.");
    if (launch.status === "queued" || launch.status === "running") return { ok: false, error: { title: "Still running", detail: "Wait for this launch to finish, then retry what failed." } };
    await assertNotKilled();
    // Items a kill switch left pending run again too.
    const count = (await resetFailedItems(getDb(), launchId)) + (await getDb().$count(launchItems, and(eq(launchItems.launchId, launchId), eq(launchItems.status, "pending"))));
    if (!count) return { ok: true, message: "Nothing failed, so there is nothing to retry." };
    await getDb().update(launches).set({ status: "queued", finishedAt: null }).where(eq(launches.id, launchId));
    await enqueue(launchId);
    revalidatePath(`/launches/${launchId}`);
    return { ok: true, message: `Retrying ${count} ${count === 1 ? "item" : "items"}.` };
  });
}

/** "Activate all": when every item is created, turns ads, new ad sets and a new campaign on. */
export async function activateAll(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const launchId = z.uuid().parse(id);
    await assertNotKilled();
    const guard = await guardLaunchActivation(session, launchId);
    if (guard.status === "approval") return { ok: true, message: `Sent for approval. ${guard.detail}` };
    const { activated } = await activateLaunch(getDb(), launchId, { actorId: session.userId, source: "ui" });
    revalidatePath(`/launches/${launchId}`);
    revalidatePath("/ads");
    return { ok: true, message: `Activated ${activated} ${activated === 1 ? "object" : "objects"}.` };
  });
}

/** "Duplicate as new launch": the same draft, back in the builder, nothing created yet. */
export async function duplicateLaunch(id: string) {
  const session = await requireRole(...EDITORS);
  const launchId = z.uuid().parse(id);
  const copyId = await asUser(session.userId, async (tx) => {
    const [launch] = await tx.select().from(launches).where(eq(launches.id, launchId));
    if (!launch) throw new Error("Launch not found.");
    const draft = { ...(launch.structure as LaunchDraft & { activatedAt?: string }) };
    delete draft.activateAfter;
    delete draft.activatedAt;
    const [row] = await tx
      .insert(launches)
      .values({ name: `${launch.name} (copy)`.slice(0, 120), presetId: launch.presetId, createdBy: session.userId, mode: launch.mode, structure: draft, status: "draft" })
      .returning({ id: launches.id });
    return row!.id;
  });
  redirect(`/launch/${copyId}`);
}
