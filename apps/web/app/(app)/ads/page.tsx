import type { Metadata } from "next";
import { adAccounts, savedViews } from "@fahd/db/schema";
import { count, desc, eq } from "drizzle-orm";
import { AdsView, type SavedView } from "@/components/table/ads-view";
import { parseFilters, resolveRanges } from "@/lib/filters";
import { loadAccountBudgets, loadAdsRows, type Level } from "@/lib/server/ads";
import { requireSession } from "@/lib/server/auth";
import { asUser } from "@/lib/server/db";

export const metadata: Metadata = { title: "Ads" };

const LEVEL_PARAM: Record<string, Level> = { campaigns: "campaign", adsets: "adset", ads: "ad" };
const uuids = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.split(",").filter((id) => /^[0-9a-f-]{36}$/.test(id)) ?? [];

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const params = await searchParams;
  const level = LEVEL_PARAM[String(params.level ?? "campaigns")] ?? "campaign";
  const filters = parseFilters(params);
  const { range, previous } = resolveRanges(filters);
  const campaignIds = uuids(params.campaigns);
  const adsetIds = uuids(params.adsets);

  const [rows, budgets, extra] = await Promise.all([
    loadAdsRows(session.userId, { level, range, previous, accountIds: filters.accountIds, campaignIds: level === "campaign" ? [] : campaignIds, adsetIds: level === "ad" ? adsetIds : [] }),
    loadAccountBudgets(session.userId, filters.accountIds),
    asUser(session.userId, async (tx) => ({
      views: await tx.select().from(savedViews).where(eq(savedViews.level, level)).orderBy(desc(savedViews.createdAt)),
      accounts: (await tx.select({ n: count() }).from(adAccounts))[0]?.n ?? 0,
    })),
  ]);

  return (
    <>
      <h1 className="sr-only">Ads</h1>
      <AdsView
        key={level}
        level={level}
        rows={rows}
        budgets={budgets}
        views={extra.views.map((v): SavedView => ({ id: v.id, name: v.name, columns: v.columns, filters: v.filters as Record<string, unknown>, sort: v.sort }))}
        canEdit={session.role !== "viewer"}
        range={range}
        parentSelection={{ campaignIds, adsetIds }}
        hasAccounts={extra.accounts > 0}
      />
    </>
  );
}


