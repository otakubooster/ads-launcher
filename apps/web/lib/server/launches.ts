import "server-only";
import { brands, launchItems, launches, presets, users } from "@fahd/db/schema";
import { asc, desc, eq, ne, sql } from "drizzle-orm";
import { asUser } from "./db";

export type LogItem = {
  id: string;
  level: "campaign" | "adset" | "creative" | "ad";
  parentId: string | null;
  name: string;
  status: "pending" | "running" | "done" | "failed";
  metaId: string | null;
  attempts: number;
  errorCode: number | null;
  errorMessage: string | null;
};

export type LaunchLog = {
  id: string;
  name: string;
  status: "draft" | "queued" | "running" | "done" | "partial" | "failed";
  preset: string;
  by: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  activateAfter: boolean;
  activatedAt: string | null;
  items: LogItem[];
};

export type LaunchListRow = {
  id: string;
  name: string;
  status: LaunchLog["status"];
  preset: string;
  by: string;
  createdAt: string;
  /** Campaigns, ad sets and ads (creatives are counted with their ad). */
  total: number;
  done: number;
  failed: number;
  ads: number;
};

/** Every submitted launch, newest first, with item counts. */
export async function loadLaunchList(userId: string): Promise<LaunchListRow[]> {
  return asUser(userId, async (tx) => {
    const counts = tx
      .select({
        launchId: launchItems.launchId,
        total: sql<number>`count(*) filter (where ${launchItems.level} <> 'creative')`.mapWith(Number).as("total"),
        done: sql<number>`count(*) filter (where ${launchItems.level} <> 'creative' and ${launchItems.status} = 'done')`.mapWith(Number).as("done"),
        failed: sql<number>`count(*) filter (where ${launchItems.level} <> 'creative' and ${launchItems.status} = 'failed')`.mapWith(Number).as("failed"),
        ads: sql<number>`count(*) filter (where ${launchItems.level} = 'ad')`.mapWith(Number).as("ads"),
      })
      .from(launchItems)
      .groupBy(launchItems.launchId)
      .as("counts");
    const rows = await tx
      .select({
        launch: launches,
        by: sql<string>`coalesce(${users.name}, ${users.email})`,
        brand: brands.name,
        market: presets.market,
        total: counts.total,
        done: counts.done,
        failed: counts.failed,
        ads: counts.ads,
      })
      .from(launches)
      .innerJoin(presets, eq(presets.id, launches.presetId))
      .innerJoin(brands, eq(brands.id, presets.brandId))
      .innerJoin(users, eq(users.id, launches.createdBy))
      .leftJoin(counts, eq(counts.launchId, launches.id))
      .where(ne(launches.status, "draft"))
      .orderBy(desc(launches.createdAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.launch.id,
      name: r.launch.name,
      status: r.launch.status,
      preset: `${r.brand} · ${r.market}`,
      by: r.by,
      createdAt: r.launch.createdAt.toISOString(),
      total: r.total ?? 0,
      done: r.done ?? 0,
      failed: r.failed ?? 0,
      ads: r.ads ?? 0,
    }));
  });
}

/** One launch with its item tree, for the launch log. */
export async function loadLaunchLog(userId: string, id: string): Promise<LaunchLog | null> {
  return asUser(userId, async (tx) => {
    const [row] = await tx
      .select({ launch: launches, by: users.name, email: users.email, brand: brands.name, market: presets.market })
      .from(launches)
      .innerJoin(presets, eq(presets.id, launches.presetId))
      .innerJoin(brands, eq(brands.id, presets.brandId))
      .innerJoin(users, eq(users.id, launches.createdBy))
      .where(eq(launches.id, id));
    if (!row) return null;
    const items = await tx.select().from(launchItems).where(eq(launchItems.launchId, id)).orderBy(asc(launchItems.createdAt), asc(launchItems.idempotencyKey));
    const l = row.launch;
    return {
      id: l.id,
      name: l.name,
      status: l.status,
      preset: `${row.brand} · ${row.market}`,
      by: row.by ?? row.email,
      createdAt: l.createdAt.toISOString(),
      startedAt: l.startedAt?.toISOString() ?? null,
      finishedAt: l.finishedAt?.toISOString() ?? null,
      activateAfter: Boolean((l.structure as { activateAfter?: boolean }).activateAfter),
      activatedAt: (l.structure as { activatedAt?: string }).activatedAt ?? null,
      items: items.map((i) => ({
        id: i.id,
        level: i.level,
        parentId: i.parentItemId,
        name: (i.payload as { name?: string }).name ?? i.level,
        status: i.status,
        metaId: i.metaId,
        attempts: i.attempts,
        errorCode: i.errorCode,
        errorMessage: i.errorMessage,
      })),
    };
  });
}
