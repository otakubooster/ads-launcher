import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adAccounts } from "@fahd/db/schema";
import { asc, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { CreativeDetailActions } from "@/components/creatives/creative-detail-actions";
import { PageHeader } from "@/components/page-header";
import { Badge, StatusDot } from "@/components/ui/badge";
import { EMPTY, formatMoney, formatNumber, formatRoas } from "@/lib/format";
import { parseFilters, resolveRanges } from "@/lib/filters";
import { requireSession } from "@/lib/server/auth";
import { loadCreatives } from "@/lib/server/creatives";
import { asUser } from "@/lib/server/db";

export const metadata: Metadata = { title: "Creative" };

const UPLOAD_TONE = { ready: "positive", error: "negative", processing: "info", uploading: "info", queued: "neutral" } as const;

export default async function CreativePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { range } = resolveRanges(parseFilters(await searchParams));
  const { items, currency } = await loadCreatives(session.userId, range, { groupOf: id });
  if (items.length === 0) notFound();
  const lead = items.find((i) => i.id === id) ?? items[0]!;

  const { accounts, ads } = await asUser(session.userId, async (tx) => ({
    accounts: await tx.select({ id: adAccounts.id, name: adAccounts.name }).from(adAccounts).orderBy(asc(adAccounts.name)),
    ads: (await tx.execute(sql`
      select a.id, a.name, a.effective_status, acc.name as account_name, acc.currency,
        coalesce(sum(i.spend), 0)::float8 spend, coalesce(sum(i.purchase_value), 0)::float8 value, coalesce(sum(i.purchases), 0)::float8 purchases
      from launch_items li join meta_ads a on a.meta_id = li.meta_id join ad_accounts acc on acc.id = a.ad_account_id
      left join insights_daily i on i.ad_id = a.id and i.date between ${range.since}::date and ${range.until}::date
      where li.level = 'ad' and li.payload->'creativeIds' ?| ${`{${items.map((i) => i.id).join(",")}}`}::text[]
      group by a.id, acc.name, acc.currency order by spend desc`)) as unknown as { id: string; name: string; effective_status: string; account_name: string; currency: string; spend: number; value: number; purchases: number }[],
  }));

  return (
    <>
      <Link href="/creatives" className="mb-3 inline-flex items-center gap-1 text-ui text-slate-11 hover:text-slate-12">
        <ArrowLeft className="size-4" />
        Creatives
      </Link>
      <PageHeader title={lead.groupKey} description={`${lead.brandName} · ${items.length} ${items.length === 1 ? "file" : "files"}`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="grid gap-3">
          {items.map((i) => (
            <figure key={i.id} className="overflow-hidden rounded-card border border-slate-6">
              {i.kind === "video" ? (
                <video src={i.mediaUrl} poster={i.previewUrl !== i.mediaUrl ? i.previewUrl : undefined} controls muted playsInline className="max-h-96 w-full bg-black object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.previewUrl} alt={i.fileName} className="max-h-96 w-full object-contain" />
              )}
              <figcaption className="flex items-center gap-2 px-3 py-2 text-ui">
                <span className="min-w-0 flex-1 truncate">{i.fileName}</span>
                {i.ratio && <Badge>{i.ratio}</Badge>}
                <span className="text-slate-11 tabular-nums">
                  {i.width}×{i.height}
                  {i.durationS !== null && ` · ${Math.round(i.durationS)}s`} · {(i.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="grid content-start gap-6">
          <CreativeDetailActions creativeIds={items.map((i) => i.id)} tags={lead.tags} accounts={accounts} canEdit={session.role !== "viewer"} />
          <section aria-labelledby="uploads-title" className="rounded-card border border-slate-6">
            <h2 id="uploads-title" className="border-b border-slate-6 px-4 py-3 text-section font-semibold">
              In Meta media libraries
            </h2>
            <ul className="divide-y divide-slate-6">
              {accounts.map((a) => (
                <li key={a.id} className="grid gap-1 px-4 py-2.5 text-ui">
                  <p className="font-medium">{a.name}</p>
                  {items.map((i) => {
                    const u = i.uploads.find((x) => x.adAccountId === a.id);
                    return (
                      <p key={i.id} className="flex items-center justify-between gap-3 text-slate-11">
                        <span className="truncate">{i.fileName}</span>
                        {u ? <StatusDot tone={UPLOAD_TONE[u.status as keyof typeof UPLOAD_TONE] ?? "neutral"} label={u.status === "ready" ? "Ready" : u.status === "error" ? (u.error ?? "Error") : u.status.charAt(0).toUpperCase() + u.status.slice(1)} /> : <span>Not uploaded</span>}
                      </p>
                    );
                  })}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="ads-title" className="rounded-card border border-slate-6">
            <h2 id="ads-title" className="border-b border-slate-6 px-4 py-3 text-section font-semibold">
              Ads using this creative
            </h2>
            {ads.length === 0 ? (
              <p className="px-4 py-4 text-body text-slate-11">Not launched yet. Select it in the library and choose Launch with selected.</p>
            ) : (
              <table className="w-full text-ui">
                <tbody>
                  {ads.map((a) => (
                    <tr key={a.id} className="h-10 border-b border-slate-6 last:border-0">
                      <td className="px-4">
                        <Link href={`/ads?level=ads&open=${a.id}`} className="font-medium hover:underline">
                          {a.name}
                        </Link>
                        <span className="text-slate-11"> · {a.account_name}</span>
                      </td>
                      <td className="px-4 text-right tabular-nums">{formatMoney(a.spend, a.currency)}</td>
                      <td className="px-4 text-right tabular-nums">{formatNumber(a.purchases)}</td>
                      <td className="px-4 text-right tabular-nums">{a.spend ? formatRoas(a.value / a.spend) : EMPTY}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="sr-only">Money in {currency} per account currency.</p>
          </section>
        </div>
      </div>
    </>
  );
}
