import type { Metadata } from "next";
import { adAccounts, brands } from "@fahd/db/schema";
import { asc } from "drizzle-orm";
import { CreativesView } from "@/components/creatives/creatives-view";
import { PageHeader } from "@/components/page-header";
import { parseFilters, resolveRanges } from "@/lib/filters";
import { requireSession } from "@/lib/server/auth";
import { loadCreatives } from "@/lib/server/creatives";
import { asUser } from "@/lib/server/db";

export const metadata: Metadata = { title: "Creatives" };

export default async function CreativesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const { range } = resolveRanges(parseFilters(await searchParams));
  const [library, options] = await Promise.all([
    loadCreatives(session.userId, range),
    asUser(session.userId, async (tx) => ({
      brands: await tx.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
      accounts: await tx.select({ id: adAccounts.id, name: adAccounts.name }).from(adAccounts).orderBy(asc(adAccounts.name)),
    })),
  ]);
  return (
    <>
      <PageHeader title="Creatives" description="Images and videos with performance across every ad that uses them." />
      <CreativesView items={library.items} perf={library.perf} currency={library.currency} brands={options.brands} accounts={options.accounts} canEdit={session.role !== "viewer"} />
    </>
  );
}
