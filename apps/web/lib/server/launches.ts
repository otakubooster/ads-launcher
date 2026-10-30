import "server-only";
import { brands, launchItems, launches, presets, users } from "@fahd/db/schema";
import { asc, eq } from "drizzle-orm";
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
  items: LogItem[];
};

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
