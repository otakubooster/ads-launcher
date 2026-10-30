import { adAccounts, adsetTemplates, metaAdsets, metaAssets, metaConnections, presets } from "@fahd/db/schema";
import type { AdsetTemplateSpec } from "@fahd/db/schema";
import { MetaApiError, describeMetaError, getTokenPermissions, missingPermissions } from "@fahd/meta";
import { and, eq } from "drizzle-orm";
import { clientForAdAccount } from "./meta-client";
import type { AnyDb } from "./types";

export type CheckLine = { label: string; ok: boolean; detail: string; warning?: boolean };

/**
 * "Test preset" (docs/spec.md → Presets): checks every ID against Meta and the
 * token's permissions, one green or red line each. `db` must be privileged.
 */
export async function testPreset(db: AnyDb, presetId: string, { checkLink = true }: { checkLink?: boolean } = {}): Promise<CheckLine[]> {
  const [preset] = await db.select().from(presets).where(eq(presets.id, presetId));
  if (!preset) throw new Error("Preset not found");
  const [account] = await db.select().from(adAccounts).where(eq(adAccounts.id, preset.adAccountId));
  if (!account) throw new Error("Ad account not found");
  const [connection] = await db.select({ status: metaConnections.status }).from(metaConnections).where(eq(metaConnections.id, account.connectionId));

  const lines: CheckLine[] = [];
  const { client, metaAccountId } = await clientForAdAccount(db, account.id);
  const opts = { accountId: metaAccountId };
  const check = async (label: string, fn: () => Promise<string>) => {
    try {
      lines.push({ label, ok: true, detail: await fn() });
    } catch (e) {
      const d = e instanceof MetaApiError ? describeMetaError(e) : null;
      lines.push({ label, ok: false, detail: d ? `${d.title}: ${d.detail}` : e instanceof Error ? e.message : String(e) });
    }
  };

  await check("Token permissions", async () => {
    if (connection?.status === "broken") throw new Error("The connection's token is not working. Replace it in Settings.");
    const missing = missingPermissions(await getTokenPermissions(client));
    if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
    return "Every required permission is granted";
  });
  await check("Ad account", async () => {
    const a = await client.get<{ name: string; account_status: number; currency: string }>(metaAccountId, { fields: "name,account_status,currency" }, opts);
    if (a.account_status !== 1) throw new Error(`${a.name} is not active (status ${a.account_status})`);
    return `${a.name} · ${a.currency}`;
  });
  await check("Launch access", async () => {
    if (!account.launchEnabled) throw new Error("Launches are turned off for this account in Settings → Ad accounts.");
    return "Launches enabled";
  });
  await check("Facebook page", async () => {
    const p = await client.get<{ name: string }>(preset.pageId, { fields: "id,name" }, opts);
    const [asset] = await db.select().from(metaAssets).where(and(eq(metaAssets.kind, "page"), eq(metaAssets.metaId, preset.pageId)));
    if (!asset) throw new Error(`${p.name} isn't assigned to the system user. Assign it in Business Settings.`);
    return p.name;
  });
  if (preset.instagramUserId) {
    await check("Instagram account", async () => {
      const ig = await client.get<{ username: string }>(preset.instagramUserId!, { fields: "id,username" }, opts);
      const [asset] = await db
        .select()
        .from(metaAssets)
        .where(and(eq(metaAssets.kind, "instagram"), eq(metaAssets.metaId, preset.instagramUserId!), eq(metaAssets.adAccountId, account.id)));
      if (!asset) throw new Error(`@${ig.username} isn't connected to ${account.name}.`);
      return `@${ig.username}`;
    });
  }
  await check("Pixel", async () => {
    const px = await client.get<{ name: string }>(preset.pixelId, { fields: "id,name" }, opts);
    const [asset] = await db
      .select()
      .from(metaAssets)
      .where(and(eq(metaAssets.kind, "pixel"), eq(metaAssets.metaId, preset.pixelId), eq(metaAssets.adAccountId, account.id)));
    if (!asset) throw new Error(`${px.name} isn't shared with ${account.name}.`);
    return `${px.name} · ${preset.conversionEvent}`;
  });
  if (checkLink) {
    try {
      const res = await fetch(preset.linkUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5_000) });
      lines.push(res.ok ? { label: "Link", ok: true, detail: `${preset.linkUrl} answers ${res.status}` } : { label: "Link", ok: false, detail: `${preset.linkUrl} answers ${res.status}` });
    } catch {
      lines.push({ label: "Link", ok: true, warning: true, detail: `Couldn't reach ${preset.linkUrl} from the server; check it opens.` });
    }
  }
  return lines;
}

const ADSET_FIELDS = "name,optimization_goal,billing_event,bid_strategy,daily_budget,targeting,attribution_spec,promoted_object";

/** Saves a live ad set's settings as a reusable template (docs/spec.md → adset_templates). */
export async function cloneAdsetTemplate(db: AnyDb, adsetId: string, name: string) {
  const [adset] = await db.select({ metaId: metaAdsets.metaId, adAccountId: metaAdsets.adAccountId }).from(metaAdsets).where(eq(metaAdsets.id, adsetId));
  if (!adset) throw new Error("Ad set not found");
  const { client, metaAccountId } = await clientForAdAccount(db, adset.adAccountId);
  const live = await client.get<Record<string, unknown>>(adset.metaId, { fields: ADSET_FIELDS }, { accountId: metaAccountId });
  const spec: AdsetTemplateSpec = {
    optimizationGoal: String(live.optimization_goal ?? "OFFSITE_CONVERSIONS"),
    billingEvent: String(live.billing_event ?? "IMPRESSIONS"),
    bidStrategy: live.bid_strategy ? String(live.bid_strategy) : undefined,
    dailyBudget: live.daily_budget ? Number(live.daily_budget) : undefined,
    targeting: (live.targeting as Record<string, unknown>) ?? {},
    attributionSpec: live.attribution_spec as AdsetTemplateSpec["attributionSpec"],
  };
  const [row] = await db.insert(adsetTemplates).values({ name, sourceAdsetId: adset.metaId, spec }).returning();
  return row!;
}
