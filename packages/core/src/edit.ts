import { metaAdsets, metaAds, metaCampaigns } from "@fahd/db/schema";
import { MetaApiError, type Params } from "@fahd/meta";
import { eq } from "drizzle-orm";
import { clientForAdAccount } from "./meta-client";
import type { MetaChange, ObjectLevel } from "./objects";
import type { AnyDb } from "./types";

/**
 * Ads Manager's edit pane for live objects. Status and budgets have their own
 * guarded paths (changeStatus, changeDailyBudget); this covers the rest.
 */
export type ObjectEdit = {
  name?: string;
  /** Ad sets: end date (ISO), or null to run continuously (daily budgets only). */
  endTime?: string | null;
  /** Ad sets on cost cap / bid cap: minor units. */
  bidAmount?: number | null;
  /** Ad sets on a ROAS goal: e.g. 2.5 for 250%. */
  roasFloor?: number | null;
  countries?: string[];
  ageMin?: number;
  ageMax?: number;
};

export type EditableObject = {
  level: ObjectLevel;
  id: string;
  name: string;
  status: string;
  bidStrategy: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  endTime: string | null;
  bidAmount: number | null;
  roasFloor: number | null;
  countries: string[];
  ageMin: number | null;
  ageMax: number | null;
  /** The campaign's strategy applies to its ad sets when the ad set has none. */
  campaignBidStrategy: string | null;
  campaignBudget: boolean;
};

type Raw = Record<string, unknown> & {
  end_time?: string;
  stop_time?: string;
  bid_amount?: string | number;
  bid_constraints?: { roas_average_floor?: number };
  targeting?: { geo_locations?: { countries?: string[] }; age_min?: number; age_max?: number } & Record<string, unknown>;
};

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

/** Current editable values, read from the mirror (Meta's last synced JSON). */
export async function loadEditable(db: AnyDb, level: ObjectLevel, id: string): Promise<EditableObject> {
  if (level === "campaign") {
    const [c] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, id));
    if (!c) throw new Error("campaign not found");
    const raw = c.raw as Raw;
    const budget = c.dailyBudget !== null || c.lifetimeBudget !== null;
    return { level, id, name: c.name, status: c.status, bidStrategy: c.bidStrategy, dailyBudget: c.dailyBudget, lifetimeBudget: c.lifetimeBudget, endTime: raw.stop_time ?? null, bidAmount: null, roasFloor: null, countries: [], ageMin: null, ageMax: null, campaignBidStrategy: c.bidStrategy, campaignBudget: budget };
  }
  if (level === "adset") {
    const [row] = await db.select({ s: metaAdsets, c: metaCampaigns }).from(metaAdsets).innerJoin(metaCampaigns, eq(metaCampaigns.id, metaAdsets.campaignId)).where(eq(metaAdsets.id, id));
    if (!row) throw new Error("ad set not found");
    const { s, c } = row;
    const raw = s.raw as Raw;
    const roas = raw.bid_constraints?.roas_average_floor;
    return {
      level,
      id,
      name: s.name,
      status: s.status,
      bidStrategy: s.bidStrategy,
      dailyBudget: s.dailyBudget,
      lifetimeBudget: s.lifetimeBudget,
      endTime: raw.end_time ?? null,
      bidAmount: num(raw.bid_amount),
      // Meta stores the ROAS floor ×10000 (2.5 → 25000).
      roasFloor: roas ? roas / 10000 : null,
      countries: raw.targeting?.geo_locations?.countries ?? [],
      ageMin: raw.targeting?.age_min ?? null,
      ageMax: raw.targeting?.age_max ?? null,
      campaignBidStrategy: c.bidStrategy,
      campaignBudget: c.dailyBudget !== null || c.lifetimeBudget !== null,
    };
  }
  const [a] = await db.select().from(metaAds).where(eq(metaAds.id, id));
  if (!a) throw new Error("ad not found");
  return { level, id, name: a.name, status: a.status, bidStrategy: null, dailyBudget: null, lifetimeBudget: null, endTime: null, bidAmount: null, roasFloor: null, countries: [], ageMin: null, ageMax: null, campaignBidStrategy: null, campaignBudget: false };
}

const TABLES = { campaign: metaCampaigns, adset: metaAdsets, ad: metaAds } as const;

/** Sends only the fields that changed; targeting keeps everything else Meta has (interests, placements, …). */
export async function editObject(db: AnyDb, level: ObjectLevel, id: string, edit: ObjectEdit): Promise<MetaChange> {
  const table = TABLES[level];
  const [row] = await db.select({ metaId: table.metaId, adAccountId: table.adAccountId, name: table.name, raw: table.raw }).from(table).where(eq(table.id, id));
  if (!row) throw new Error(`${level} not found`);
  const current = await loadEditable(db, level, id);
  const raw = row.raw as Raw;
  const params: Params = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const change = (key: string, from: unknown, to: unknown, value: unknown = to) => {
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return;
    before[key] = from ?? null;
    after[key] = to ?? null;
    params[key] = value as Params[string];
  };

  if (edit.name !== undefined) {
    const name = edit.name.trim();
    if (!name) throw new MetaApiError({ kind: "guard", message: "Name can't be empty" });
    if (name.length > 400) throw new MetaApiError({ kind: "guard", message: "Names are capped at 400 characters" });
    change("name", current.name, name);
  }

  if (level === "adset") {
    if (edit.endTime !== undefined) {
      if (edit.endTime === null && current.lifetimeBudget !== null) throw new MetaApiError({ kind: "guard", message: "A lifetime budget needs an end date" });
      if (edit.endTime && new Date(edit.endTime).getTime() < Date.now()) throw new MetaApiError({ kind: "guard", message: "The end date is in the past" });
      // Meta clears an end date with end_time = 0.
      change("end_time", current.endTime, edit.endTime, edit.endTime ?? 0);
    }
    const strategy = current.bidStrategy ?? current.campaignBidStrategy;
    if (edit.bidAmount !== undefined && (strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP")) {
      if (!edit.bidAmount || edit.bidAmount <= 0 || !Number.isInteger(edit.bidAmount)) throw new MetaApiError({ kind: "guard", message: "Set a positive amount" });
      change("bid_amount", current.bidAmount, edit.bidAmount);
    }
    if (edit.roasFloor !== undefined && strategy === "LOWEST_COST_WITH_MIN_ROAS") {
      if (!edit.roasFloor || edit.roasFloor <= 0) throw new MetaApiError({ kind: "guard", message: "Set a ROAS goal above 0" });
      const floor = Math.round(edit.roasFloor * 10000);
      change("bid_constraints", raw.bid_constraints?.roas_average_floor ?? null, floor, { roas_average_floor: floor });
    }
    const targetingEdit = edit.countries !== undefined || edit.ageMin !== undefined || edit.ageMax !== undefined;
    if (targetingEdit) {
      const countries = edit.countries ?? current.countries;
      const ageMin = edit.ageMin ?? current.ageMin ?? 18;
      const ageMax = edit.ageMax ?? current.ageMax ?? 65;
      if (countries.length === 0) throw new MetaApiError({ kind: "guard", message: "Choose at least one location" });
      if (ageMin < 13 || ageMax > 65 || ageMin > ageMax) throw new MetaApiError({ kind: "guard", message: "Ages run from 13 to 65, minimum first" });
      const targeting = { ...(raw.targeting ?? {}) };
      const geo = { ...(targeting.geo_locations ?? {}) } as Record<string, unknown>;
      if (edit.countries) {
        // Countries replace any regions, cities or zips that were there.
        for (const k of ["regions", "cities", "zips", "places", "custom_locations", "geo_markets", "electoral_districts"]) delete geo[k];
        geo.countries = countries;
      }
      const next = { ...targeting, geo_locations: geo, age_min: ageMin, age_max: ageMax };
      const was = { countries: current.countries, age_min: current.ageMin, age_max: current.ageMax };
      const now = { countries, age_min: ageMin, age_max: ageMax };
      if (JSON.stringify(was) !== JSON.stringify(now)) {
        before.targeting = was;
        after.targeting = now;
        params.targeting = next;
      }
    }
  }

  if (Object.keys(params).length === 0) return { level, id, metaId: row.metaId, adAccountId: row.adAccountId, name: row.name, before, after, metaResponse: { skipped: "no changes" } };

  const { client, metaAccountId } = await clientForAdAccount(db, row.adAccountId);
  const metaResponse = await client.post<{ success: boolean }>(row.metaId, params, { accountId: metaAccountId });

  // Mirror what Meta now has, so the table shows it before the next sync.
  const nextRaw: Raw = { ...raw };
  if ("end_time" in params) nextRaw.end_time = edit.endTime ?? undefined;
  if ("bid_amount" in params) nextRaw.bid_amount = edit.bidAmount ?? undefined;
  if ("bid_constraints" in params) nextRaw.bid_constraints = params.bid_constraints as Raw["bid_constraints"];
  if ("targeting" in params) nextRaw.targeting = params.targeting as Raw["targeting"];
  if ("name" in params) nextRaw.name = params.name;
  await db
    .update(table)
    .set({ ...("name" in params ? { name: params.name as string } : {}), raw: nextRaw })
    .where(eq(table.id, id));

  return { level, id, metaId: row.metaId, adAccountId: row.adAccountId, name: (params.name as string) ?? row.name, before, after, metaResponse };
}
