"use server";

import { checkSpend, createLaunchItems } from "@fahd/core";
import { adAccounts, launches, presets } from "@fahd/db/schema";
import { buildPlan, planHasErrors, type LaunchDraft } from "@fahd/shared/launch-plan";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, UserError, runAction } from "@/lib/server/action-result";
import { requireRole } from "@/lib/server/auth";
import { asUser, getDb } from "@/lib/server/db";
import { GuardrailError, assertNotKilled } from "@/lib/server/guard";
import { draftFromPreset, planContext } from "@/lib/server/launch";
import { kickLaunch } from "@/lib/server/launch-runner";
import { getQueues } from "@/lib/server/queue";

const EDITORS = ["owner", "admin", "buyer"] as const;

export async function createDraft(presetId: string, creativeIds: string[] = []) {
  const session = await requireRole(...EDITORS);
  const input = z.object({ presetId: z.uuid(), creativeIds: z.array(z.uuid()).max(200) }).parse({ presetId, creativeIds });
  const id = await asUser(session.userId, async (tx) => {
    const { draft, name } = await draftFromPreset(tx, input.presetId, input.creativeIds);
    const [row] = await tx
      .insert(launches)
      .values({ name, presetId: input.presetId, createdBy: session.userId, mode: draft.destination.mode, structure: draft, status: "draft" })
      .returning({ id: launches.id });
    return row!.id;
  });
  redirect(`/launch/${id}`);
}

/** Autosave. Changing the preset re-reads its account defaults on the client. */
export async function saveDraft(id: string, patch: { name: string; presetId: string; structure: LaunchDraft }): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const input = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120), presetId: z.uuid() }).parse({ id, ...patch });
    const updated = await asUser(session.userId, (tx) =>
      tx
        .update(launches)
        .set({ name: input.name, presetId: input.presetId, mode: patch.structure.destination.mode, structure: patch.structure })
        .where(and(eq(launches.id, input.id), eq(launches.status, "draft")))
        .returning({ id: launches.id }),
    );
    if (!updated.length) return { ok: false, error: { title: "Not saved", detail: "This launch is no longer a draft, or you can't edit it." } };
    return { ok: true };
  });
}

export async function deleteDraft(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    await asUser(session.userId, (tx) => tx.delete(launches).where(and(eq(launches.id, z.uuid().parse(id)), eq(launches.status, "draft"))));
    revalidatePath("/launch");
    return { ok: true, message: "Draft deleted." };
  });
}

/**
 * "Create paused" (or owner/admin "Create & activate"): re-plans on the server,
 * writes the launch_items tree, queues the run and opens the launch log.
 */
export async function submitLaunch(id: string, { activate = false }: { activate?: boolean } = {}): Promise<ActionResult> {
  const result = await runAction(async () => {
    const session = await requireRole(...EDITORS);
    if (activate && session.role === "buyer") return { ok: false, error: { title: "Not allowed", detail: "Only owners and admins can create and activate in one step. Create it paused." } };
    const launchId = z.uuid().parse(id);
    await assertNotKilled();
    const plan = await asUser(session.userId, async (tx) => {
      const [launch] = await tx.select().from(launches).where(eq(launches.id, launchId));
      if (!launch || launch.status !== "draft") throw new Error("This launch was already submitted.");
      const draft = { ...(launch.structure as LaunchDraft), activateAfter: activate };
      const [preset] = await tx
        .select({ adAccountId: presets.adAccountId, launchEnabled: adAccounts.launchEnabled, accountName: adAccounts.name })
        .from(presets)
        .innerJoin(adAccounts, eq(adAccounts.id, presets.adAccountId))
        .where(eq(presets.id, launch.presetId));
      if (!preset) throw new Error("Preset not found");
      if (!preset.launchEnabled) {
        throw new UserError("Launches are off for this ad account", `${preset.accountName} doesn't accept launches yet.`, "An owner or admin can turn on Launches enabled in Settings → Ad accounts.");
      }
      const p = buildPlan(draft, await planContext(tx, launch.presetId, draft));
      if (planHasErrors(p)) return { error: p };
      // Create & activate releases the plan's budget at once: the account maximum applies.
      if (activate) {
        const decision = await checkSpend(getDb(), { adAccountId: preset.adAccountId, role: session.role, increase: p.totals.dailyBudget });
        if (decision.decision !== "allow") throw new GuardrailError(decision);
      }
      await createLaunchItems(tx, launchId, p);
      await tx.update(launches).set({ status: "queued", structure: draft }).where(eq(launches.id, launchId));
      return { adAccountId: preset.adAccountId };
    });
    if ("error" in plan) return { ok: false, error: { title: "Fix the review first", detail: "Some rows have errors. Open Review to see them." } };

    const queues = getQueues();
    if (queues) await queues.add({ kind: "launch", adAccountId: plan.adAccountId, launchId }, launchId);
    else await kickLaunch(launchId);
    return { ok: true };
  });
  if (result.ok) redirect(`/launches/${id}`);
  return result;
}

/** Switching preset re-reads its defaults (naming, features, link, countries) and keeps creatives and copy. */
export async function changePreset(id: string, presetId: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const input = z.object({ id: z.uuid(), presetId: z.uuid() }).parse({ id, presetId });
    await asUser(session.userId, async (tx) => {
      const [launch] = await tx.select().from(launches).where(and(eq(launches.id, input.id), eq(launches.status, "draft")));
      if (!launch) throw new Error("This launch is no longer a draft.");
      const old = launch.structure as LaunchDraft;
      const { draft } = await draftFromPreset(tx, input.presetId);
      const next: LaunchDraft = {
        ...draft,
        destination: { ...draft.destination, budgetType: old.destination.budgetType, dailyBudget: old.destination.dailyBudget },
        creatives: old.creatives,
        copy: { ...old.copy, cta: draft.copy.cta, link: draft.copy.link },
        structure: { ...draft.structure, grouping: old.structure.grouping, perAdset: old.structure.perAdset, start: old.structure.start, startTime: old.structure.startTime },
      };
      await tx.update(launches).set({ presetId: input.presetId, mode: next.destination.mode, structure: next }).where(eq(launches.id, input.id));
    });
    revalidatePath(`/launch/${input.id}`);
    return { ok: true, message: "Preset changed. Naming, Advantage+ features and link now follow it." };
  });
}
