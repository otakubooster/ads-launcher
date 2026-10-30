"use server";

import { cloneAdsetTemplate, testPreset, type CheckLine } from "@fahd/core";
import { adsetTemplates, brands, namingTemplates, presets } from "@fahd/db/schema";
import { CONVERSION_EVENTS, CREATIVE_FEATURES, CTA_TYPES } from "@fahd/shared/meta-options";
import { unknownTokens } from "@fahd/shared/naming";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/server/action-result";
import { requireRole } from "@/lib/server/auth";
import { asUser, getDb } from "@/lib/server/db";

const EDITORS = ["owner", "admin", "buyer"] as const;
const optionalUuid = z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null);
const metaId = z.string().trim().regex(/^\d{5,25}$/, "Pick it from the list.");

export async function createBrand(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const input = z
      .object({ name: z.string().trim().min(1, "Name the brand.").max(60), defaultDomain: z.string().trim().max(120).optional() })
      .parse(Object.fromEntries(formData));
    await asUser(session.userId, (tx) => tx.insert(brands).values({ name: input.name, defaultDomain: input.defaultDomain || null }));
    revalidatePath("/presets");
    return { ok: true, message: `Added ${input.name}.` };
  });
}

const presetInput = z.object({
  id: optionalUuid,
  brandId: z.uuid("Pick a brand."),
  market: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Market is a 2-letter country code, like US or GB."),
  language: z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z]{2})?$/, "Language is a code like en or fr."),
  adAccountId: z.uuid("Pick an ad account."),
  pageId: metaId,
  instagramUserId: z.union([metaId, z.literal("")]).transform((v) => v || null),
  pixelId: metaId,
  conversionEvent: z.enum(CONVERSION_EVENTS),
  linkUrl: z.url("Enter the full landing page URL, starting with https://."),
  urlTags: z.string().trim().max(500),
  defaultCta: z.enum(CTA_TYPES),
  namingTemplateId: optionalUuid,
  adsetNamingTemplateId: optionalUuid,
  adNamingTemplateId: optionalUuid,
  adsetTemplateId: optionalUuid,
});

export async function savePreset(_prev: ActionResult | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const input = presetInput.parse(Object.fromEntries(formData));
    const creativeFeatures = Object.fromEntries(
      CREATIVE_FEATURES.map((f) => [f.key, formData.get(`feature_${f.key}`) === "on" ? "OPT_IN" : "OPT_OUT"] as const),
    );
    const { id, ...values } = input;
    const row = await asUser(session.userId, async (tx) => {
      if (id) {
        const [r] = await tx.update(presets).set({ ...values, creativeFeatures }).where(eq(presets.id, id)).returning({ id: presets.id });
        return r;
      }
      const [r] = await tx.insert(presets).values({ ...values, creativeFeatures }).returning({ id: presets.id });
      return r;
    });
    if (!row) throw new Error("Preset not found");
    revalidatePath("/presets");
    return { ok: true, message: `Preset ${input.market} · ${input.language} saved.`, data: { id: row.id } };
  });
}

export async function deletePreset(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    await asUser(session.userId, (tx) => tx.delete(presets).where(eq(presets.id, z.uuid().parse(id))));
    revalidatePath("/presets");
    return { ok: true, message: "Preset deleted." };
  });
}

/** Checks every ID in the preset against Meta (docs/spec.md → Test preset). */
export async function testPresetAction(id: string): Promise<ActionResult<CheckLine[]>> {
  return runAction<CheckLine[]>(async () => {
    const session = await requireRole();
    const presetId = z.uuid().parse(id);
    const [visible] = await asUser(session.userId, (tx) => tx.select({ id: presets.id }).from(presets).where(eq(presets.id, presetId)));
    if (!visible) throw new Error("Preset not found");
    return { ok: true, data: await testPreset(getDb(), presetId) };
  });
}

export async function saveNamingTemplate(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const input = z
      .object({ id: optionalUuid, level: z.enum(["campaign", "adset", "ad"]), pattern: z.string().trim().min(1, "Write a pattern.").max(200) })
      .parse(Object.fromEntries(formData));
    const unknown = unknownTokens(input.pattern);
    if (unknown.length) return { ok: false, error: { title: "Unknown token", detail: `{${unknown.join("}, {")}} isn't a naming token.`, fix: "Use {brand} {market} {angle} {hook} {format} {date} {n}." } };
    await asUser(session.userId, (tx) =>
      input.id
        ? tx.update(namingTemplates).set({ level: input.level, pattern: input.pattern }).where(eq(namingTemplates.id, input.id))
        : tx.insert(namingTemplates).values({ level: input.level, pattern: input.pattern }),
    );
    revalidatePath("/presets");
    return { ok: true, message: "Naming template saved." };
  });
}

export async function deleteNamingTemplate(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    await asUser(session.userId, (tx) => tx.delete(namingTemplates).where(eq(namingTemplates.id, z.uuid().parse(id))));
    revalidatePath("/presets");
    return { ok: true, message: "Template deleted." };
  });
}

export async function cloneAdsetTemplateAction(adsetId: string, name: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole(...EDITORS);
    const input = z.object({ adsetId: z.uuid(), name: z.string().trim().min(1, "Name the template.").max(80) }).parse({ adsetId, name });
    await cloneAdsetTemplate(getDb(), input.adsetId, input.name);
    revalidatePath("/presets");
    return { ok: true, message: `Saved ad set template "${input.name}".` };
  });
}

export async function deleteAdsetTemplate(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    await asUser(session.userId, (tx) => tx.delete(adsetTemplates).where(eq(adsetTemplates.id, z.uuid().parse(id))));
    revalidatePath("/presets");
    return { ok: true, message: "Template deleted." };
  });
}
