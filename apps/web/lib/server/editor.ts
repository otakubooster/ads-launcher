import "server-only";
import { todayIn } from "@fahd/core";
import { adAccounts, brands, launches, metaAssets, presets } from "@fahd/db/schema";
import { newEditorDoc, type EditorDefaults, type EditorDoc } from "@fahd/shared/editor";
import { CREATIVE_FEATURES } from "@fahd/shared/meta-options";
import { DEFAULT_URL_TAGS } from "@fahd/shared/meta-options";
import { and, eq, isNull, or } from "drizzle-orm";
import { asUser } from "./db";

type Tx = Parameters<Parameters<typeof asUser>[1]>[0];

export type EditorAccount = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  pages: { id: string; name: string }[];
  instagram: { id: string; name: string }[];
  pixels: { id: string; name: string }[];
};

export type EditorData = {
  launch: { id: string; name: string; presetId: string; doc: EditorDoc };
  defaults: EditorDefaults;
  account: EditorAccount;
  brandId: string;
  brandName: string;
};

/** The preset's ad account, Page, Instagram account, pixel, link and UTMs as editor defaults. */
export async function editorDefaults(tx: Tx, presetId: string): Promise<{ defaults: EditorDefaults; account: EditorAccount; brandId: string; brandName: string } | null> {
  const [row] = await tx
    .select({ preset: presets, brand: brands.name, account: adAccounts })
    .from(presets)
    .innerJoin(brands, eq(brands.id, presets.brandId))
    .innerJoin(adAccounts, eq(adAccounts.id, presets.adAccountId))
    .where(eq(presets.id, presetId));
  if (!row) return null;
  const p = row.preset;
  const assets = await tx
    .select({ kind: metaAssets.kind, metaId: metaAssets.metaId, name: metaAssets.name })
    .from(metaAssets)
    .where(and(eq(metaAssets.connectionId, row.account.connectionId), or(isNull(metaAssets.adAccountId), eq(metaAssets.adAccountId, row.account.id))));
  const of = (kind: "page" | "instagram" | "pixel") => assets.filter((a) => a.kind === kind).map((a) => ({ id: a.metaId, name: a.name }));
  return {
    brandId: p.brandId,
    brandName: row.brand,
    defaults: {
      brand: row.brand,
      market: p.market,
      date: todayIn(row.account.timezone),
      pageId: p.pageId,
      instagramUserId: p.instagramUserId,
      pixelId: p.pixelId,
      event: p.conversionEvent,
      link: p.linkUrl,
      cta: p.defaultCta,
      urlTags: p.urlTags ?? DEFAULT_URL_TAGS,
      features: Object.fromEntries(CREATIVE_FEATURES.map((f) => [f.key, (p.creativeFeatures as Record<string, "OPT_IN" | "OPT_OUT">)[f.key] ?? "OPT_OUT"])),
    },
    account: { id: row.account.id, name: row.account.name, currency: row.account.currency, timezone: row.account.timezone, pages: of("page"), instagram: of("instagram"), pixels: of("pixel") },
  };
}

export function isEditorLaunch(structure: unknown): structure is { editor: EditorDoc } {
  return typeof structure === "object" && structure !== null && "editor" in structure;
}

/** An editor draft and what its pickers need; null when missing, { status } once submitted. */
export async function loadEditor(userId: string, launchId: string): Promise<EditorData | { status: string } | null> {
  return asUser(userId, async (tx) => {
    const [launch] = await tx.select().from(launches).where(eq(launches.id, launchId));
    if (!launch) return null;
    if (launch.status !== "draft") return { status: launch.status };
    const base = await editorDefaults(tx, launch.presetId);
    if (!base) return null;
    const doc = isEditorLaunch(launch.structure) ? launch.structure.editor : newEditorDoc(base.defaults);
    return { launch: { id: launch.id, name: launch.name, presetId: launch.presetId, doc }, ...base };
  });
}
