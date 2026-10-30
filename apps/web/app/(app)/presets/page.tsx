import type { Metadata } from "next";
import { adAccounts, adsetTemplates, brands, metaAdsets, metaAssets, namingTemplates, presets } from "@fahd/db/schema";
import { asc, eq, ne } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { PresetsView } from "@/components/presets/presets-view";
import { requireSession } from "@/lib/server/auth";
import { asUser } from "@/lib/server/db";

export const metadata: Metadata = { title: "Presets" };

export default async function PresetsPage() {
  const session = await requireSession();
  const data = await asUser(session.userId, async (tx) => ({
    brands: await tx.select().from(brands).orderBy(asc(brands.name)),
    presets: await tx.select().from(presets).orderBy(asc(presets.market)),
    accounts: await tx.select({ id: adAccounts.id, name: adAccounts.name, metaId: adAccounts.metaId, currency: adAccounts.currency }).from(adAccounts).orderBy(asc(adAccounts.name)),
    assets: await tx.select({ kind: metaAssets.kind, metaId: metaAssets.metaId, name: metaAssets.name, adAccountId: metaAssets.adAccountId }).from(metaAssets).orderBy(asc(metaAssets.name)),
    naming: await tx.select().from(namingTemplates).orderBy(asc(namingTemplates.level), asc(namingTemplates.createdAt)),
    adsetTemplates: await tx.select().from(adsetTemplates).orderBy(asc(adsetTemplates.name)),
    adsets: await tx
      .select({ id: metaAdsets.id, name: metaAdsets.name, accountName: adAccounts.name })
      .from(metaAdsets)
      .innerJoin(adAccounts, eq(adAccounts.id, metaAdsets.adAccountId))
      .where(ne(metaAdsets.status, "DELETED"))
      .orderBy(asc(metaAdsets.name)),
  }));

  return (
    <>
      <PageHeader title="Presets" description="Where each brand and market's ads go, how they're named, and which ad set settings they start from." />
      <PresetsView
        canEdit={session.role !== "viewer"}
        brands={data.brands.map((b) => ({ id: b.id, name: b.name, defaultDomain: b.defaultDomain }))}
        presets={data.presets.map((p) => ({ ...p, createdAt: undefined, updatedAt: undefined, creativeFeatures: p.creativeFeatures as Record<string, string> }))}
        accounts={data.accounts}
        assets={data.assets}
        naming={data.naming.map((n) => ({ id: n.id, level: n.level, pattern: n.pattern }))}
        adsetTemplates={data.adsetTemplates.map((t) => ({ id: t.id, name: t.name, sourceAdsetId: t.sourceAdsetId, spec: t.spec }))}
        adsets={data.adsets}
      />
    </>
  );
}
