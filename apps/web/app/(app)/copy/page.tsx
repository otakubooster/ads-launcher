import type { Metadata } from "next";
import { brands, copySets } from "@fahd/db/schema";
import { asc, desc } from "drizzle-orm";
import { CopyView } from "@/components/copy/copy-view";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/server/auth";
import { asUser } from "@/lib/server/db";

export const metadata: Metadata = { title: "Copy" };

export default async function CopyPage() {
  const session = await requireSession();
  const data = await asUser(session.userId, async (tx) => ({
    brands: await tx.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
    sets: await tx.select().from(copySets).orderBy(desc(copySets.updatedAt)),
  }));
  return (
    <>
      <PageHeader title="Copy" description="Reusable primary texts, headlines and CTAs per brand and language." />
      <CopyView
        canEdit={session.role !== "viewer"}
        brands={data.brands}
        sets={data.sets.map((s) => ({ id: s.id, name: s.name, brandId: s.brandId, language: s.language, primaryTexts: s.primaryTexts, headlines: s.headlines, descriptions: s.descriptions, ctaType: s.ctaType, updatedAt: s.updatedAt.toISOString() }))}
      />
    </>
  );
}
