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

/** Scheduled sync for hosts without the worker: every 15 min (quick) and once a day (?mode=daily). */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const mode = request.nextUrl.searchParams.get("mode") === "daily" ? "daily" : "quick";
  const result = await scheduledSync(getDb(), mode);
  return NextResponse.json({ mode, ...result }, { status: result.failed.length && !result.accounts ? 502 : 200 });
}
