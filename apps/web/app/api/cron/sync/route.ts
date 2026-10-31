import { scheduledSync, stalledLaunches } from "@fahd/core";
import { NextResponse, type NextRequest } from "next/server";
import { authorizedInternal } from "@/lib/server/cron-auth";
import { getDb } from "@/lib/server/db";
import { callStep } from "@/lib/server/launch-runner";

export const dynamic = "force-dynamic";
// A handful of accounts takes seconds; the cap keeps a stuck Meta call from running on.
export const maxDuration = 60;

/**
 * Scheduled sync for hosts without the worker: every 15 min (quick), once a day
 * (?mode=daily), and on demand ?mode=backfill&days=30 to re-pull history.
 */
export async function GET(request: NextRequest) {
  if (!authorizedInternal(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const param = request.nextUrl.searchParams.get("mode");
  const mode = param === "daily" || param === "backfill" ? param : "quick";
  const days = Math.min(90, Math.max(10, Number(request.nextUrl.searchParams.get("days")) || 30));
  const result = await scheduledSync(getDb(), mode, days);
  // Safety net: a launch whose step chain broke continues from where it stopped.
  const origin = process.env.APP_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;
  const resumed = await stalledLaunches(getDb());
  await Promise.all(resumed.map((id) => callStep(origin, id)));
  return NextResponse.json({ mode, ...result, resumedLaunches: resumed.length }, { status: result.failed.length && !result.accounts ? 502 : 200 });
}
