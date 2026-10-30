import "server-only";
import { convertMinor, loadRates, storageFromEnv } from "@fahd/core";
import { sql } from "drizzle-orm";
import type { DateRange } from "@/lib/date-range";
import { asUser } from "./db";
import { getQueues } from "./queue";

export type CreativeItem = {
  id: string;
  brandId: string;
  brandName: string;
  fileName: string;
  kind: "image" | "video";
  ratio: string | null;
  width: number;
  height: number;
  durationS: number | null;
  sizeBytes: number;
  groupKey: string;
  tags: { angle?: string; hook?: string; format?: string; language?: string };
  createdAt: string;
  previewUrl: string;
  mediaUrl: string;
  uploads: { adAccountId: string; status: string; error: string | null }[];
};

export type CreativePerf = { spend: number; value: number; plays: number; impressions: number; ads: number };

/** Library rows with signed preview URLs, per-account upload state and performance. */
export async function loadCreatives(userId: string, range: DateRange, where: { id?: string; groupOf?: string } = {}) {
  const rows = await asUser(userId, async (tx) => {
    const filter = where.id
      ? sql`where c.id = ${where.id}`
      : where.groupOf
        ? sql`where (c.brand_id, c.group_key) = (select brand_id, group_key from creatives where id = ${where.groupOf})`
        : sql``;
    const items = (await tx.execute(sql`
      select c.id, c.brand_id, b.name as brand_name, c.file_name, c.kind, c.ratio, c.width, c.height, c.duration_s::float8, c.size_bytes::float8,
        c.group_key, c.tags, c.created_at, c.storage_path, c.thumbnail_path,
        coalesce((select json_agg(json_build_object('adAccountId', u.ad_account_id, 'status', u.status, 'error', u.error)) from creative_uploads u where u.creative_id = c.id), '[]') as uploads
      from creatives c join brands b on b.id = c.brand_id ${filter}
      order by c.created_at desc`)) as unknown as Record<string, unknown>[];
    const perf = (await tx.execute(sql`
      select c.id, acc.currency, coalesce(sum(i.spend), 0)::float8 spend, coalesce(sum(i.purchase_value), 0)::float8 value,
        coalesce(sum(i.video_3s_plays), 0)::float8 plays, coalesce(sum(i.impressions), 0)::float8 impressions, count(distinct a.id)::int ads
      from creatives c
      join launch_items li on li.level = 'ad' and li.meta_id is not null and li.payload->'creativeIds' ? c.id::text
      join meta_ads a on a.meta_id = li.meta_id
      join ad_accounts acc on acc.id = a.ad_account_id
      left join insights_daily i on i.ad_id = a.id and i.date between ${range.since}::date and ${range.until}::date
      group by c.id, acc.currency`)) as unknown as { id: string; currency: string; spend: number; value: number; plays: number; impressions: number; ads: number }[];
    return { items, perf };
  });

  const storage = storageFromEnv();
  const items: CreativeItem[] = await Promise.all(
    rows.items.map(async (r) => {
      const mediaUrl = await storage.signedReadUrl(String(r.storage_path), 3600);
      return {
        id: String(r.id),
        brandId: String(r.brand_id),
        brandName: String(r.brand_name),
        fileName: String(r.file_name),
        kind: r.kind as "image" | "video",
        ratio: (r.ratio as string | null) ?? null,
        width: Number(r.width),
        height: Number(r.height),
        durationS: r.duration_s === null ? null : Number(r.duration_s),
        sizeBytes: Number(r.size_bytes),
        groupKey: String(r.group_key),
        tags: (r.tags as CreativeItem["tags"]) ?? {},
        createdAt: new Date(String(r.created_at)).toISOString(),
        mediaUrl,
        previewUrl: r.thumbnail_path ? await storage.signedReadUrl(String(r.thumbnail_path), 3600) : mediaUrl,
        uploads: r.uploads as CreativeItem["uploads"],
      };
    }),
  );

  const reporting = process.env.REPORTING_CURRENCY ?? "USD";
  const rates = await loadRates(reporting, { redis: getQueues()?.connection });
  const perf: Record<string, CreativePerf> = {};
  for (const p of rows.perf) {
    const spend = convertMinor(p.spend, p.currency, rates);
    const value = convertMinor(p.value, p.currency, rates);
    if (spend === null || value === null) continue;
    const acc = (perf[p.id] ??= { spend: 0, value: 0, plays: 0, impressions: 0, ads: 0 });
    acc.spend += spend;
    acc.value += value;
    acc.plays += p.plays;
    acc.impressions += p.impressions;
    acc.ads += p.ads;
  }
  return { items, perf, currency: reporting };
}
