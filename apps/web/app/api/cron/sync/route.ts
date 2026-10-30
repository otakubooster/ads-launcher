import { timingSafeEqual } from "node:crypto";
import { scheduledSync } from "@fahd/core";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";
// A handful of accounts takes seconds; the cap keeps a stuck Meta call from running on.
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; cron-job.org uses ?key=.
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? request.nextUrl.searchParams.get("key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled sync for hosts without the worker: every 15 min (quick), once a day
 * (?mode=daily), and on demand ?mode=backfill&days=30 to re-pull history.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const param = request.nextUrl.searchParams.get("mode");
  const mode = param === "daily" || param === "backfill" ? param : "quick";
  const days = Math.min(90, Math.max(10, Number(request.nextUrl.searchParams.get("days")) || 30));
  const result = await scheduledSync(getDb(), mode, days);
  return NextResponse.json({ mode, ...result }, { status: result.failed.length && !result.accounts ? 502 : 200 });
}
