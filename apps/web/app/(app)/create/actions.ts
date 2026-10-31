"use server";

import { checkSpend, createLaunchItems } from "@fahd/core";
import { adAccounts, creatives, launches, presets } from "@fahd/db/schema";
import { editorHasErrors, editorToPlan, newEditorDoc, validateEditor, type EditorDoc } from "@fahd/shared/editor";
import { EMPTY_DRAFT } from "@fahd/shared/launch-plan";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, UserError, runAction } from "@/lib/server/action-result";
import { requireRole } from "@/lib/server/auth";
import { asUser, getDb } from "@/lib/server/db";
import { editorDefaults, isEditorLaunch } from "@/lib/server/editor";
import { GuardrailError, assertNotKilled } from "@/lib/server/guard";
import { kickLaunch } from "@/lib/server/launch-runner";
import { getQueues } from "@/lib/server/queue";

const EDITORS = ["owner", "admin", "buyer"] as const;

/** "Create" → a new Ads Manager-style draft from a preset, opened in the editor. */
export async function createCampaignDraft(presetId: string) {
  const session = await requireRole(...EDITORS);
  const id = z.uuid().parse(presetId);
  const draftId = await asUser(session.userId, async (tx) => {
    const base = await editorDefaults(tx, id);
    if (!base) throw new UserError("Preset not found", "Pick another preset.");
    const doc = newEditorDoc(base.defaults);
    const [row] = await tx
      .insert(launches)
      .values({ name: doc.campaign.name, presetId: id, createdBy: session.userId, mode: "new_campaign", structure: { ...EMPTY_DRAFT, editor: doc }, status: "draft" })
      .returning({ id: launches.id });
    return row!.id;
  });
  redirect(`/create/${draftId}`);
}

// Loose on purpose: the editor's own checks run before publishing.
const docSchema = z.object({ campaign: z.object({ name: z.string().max(400) }).passthrough(), adsets: z.array(z.object({ key: z.string(), ads: z.array(z.object({ key: z.string() }).passthrough()).max(50) }).passthrough()).max(100) }).passthrough();

/** Autosave of the whole tree while it's a draft. */
export async function saveEditor(id: string, doc: EditorDoc): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const launchId = z.uuid().parse(id);
    docSchema.parse(doc);
    const updated = await asUser(session.userId, (tx) =>
      tx
        .update(launches)
        .set({ name: doc.campaign.name.trim().slice(0, 120) || "Untitled campaign", structure: { ...EMPTY_DRAFT, editor: doc } })
        .where(and(eq(launches.id, launchId), eq(launches.status, "draft")))
        .returning({ id: launches.id }),
    );
    if (!updated.length) return { ok: false, error: { title: "Not saved", detail: "This campaign was already published, or you can't edit it." } };
    return { ok: true };
  });
}

/** Publish: checks again on the server, writes the tree, creates everything paused and opens the log. */
export async function publishEditor(id: string): Promise<ActionResult> {
  const result = await runAction(async () => {
    const session = await requireRole(...EDITORS);
    const launchId = z.uuid().parse(id);
    await assertNotKilled();
    const account = await asUser(session.userId, async (tx) => {
      const [launch] = await tx.select().from(launches).where(eq(launches.id, launchId));
      if (!launch || launch.status !== "draft" || !isEditorLaunch(launch.structure)) throw new UserError("Already published", "Open it from the Launch log.");
      const doc = launch.structure.editor;
      const [preset] = await tx
        .select({ adAccountId: presets.adAccountId, launchEnabled: adAccounts.launchEnabled, accountName: adAccounts.name })
        .from(presets)
        .innerJoin(adAccounts, eq(adAccounts.id, presets.adAccountId))
        .where(eq(presets.id, launch.presetId));
      if (!preset) throw new Error("Preset not found");
      if (!preset.launchEnabled) throw new UserError("Launches are off for this ad account", `${preset.accountName} doesn't accept launches yet.`, "Turn on Launches in Settings → Ad accounts.");
      const ids = [...new Set(doc.adsets.flatMap((s) => s.ads.flatMap((a) => a.creativeIds)))];
      const files = ids.length ? await tx.select({ id: creatives.id, ratio: creatives.ratio, kind: creatives.kind }).from(creatives).where(inArray(creatives.id, ids)) : [];
      const fileMap = Object.fromEntries(files.map((f) => [f.id, { ratio: f.ratio, kind: f.kind }]));
      const issues = validateEditor(doc, fileMap);
      if (editorHasErrors(issues)) throw new UserError("Fix the highlighted fields first", `${issues.filter((i) => i.level === "error").length} things need attention.`, "Items with a red dot in the left panel show what's missing.");
      const plan = editorToPlan(doc, fileMap);
      // Nothing spends yet (everything is paused), so only the account maximum is checked here.
      const decision = await checkSpend(getDb(), { adAccountId: preset.adAccountId, role: session.role, increase: 0 });
      if (decision.decision === "block") throw new GuardrailError(decision);
      await createLaunchItems(tx, launchId, plan);
      await tx.update(launches).set({ status: "queued" }).where(eq(launches.id, launchId));
      return preset.adAccountId;
    });
    const queues = getQueues();
    if (queues) await queues.add({ kind: "launch", adAccountId: account, launchId }, launchId);
    else await kickLaunch(launchId);
    return { ok: true };
  });
  if (result.ok) redirect(`/launches/${id}`);
  return result;
}
