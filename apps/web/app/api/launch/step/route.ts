import { acquireLaunchLease, releaseLaunchLease, runLaunch, storageFromEnv } from "@fahd/core";
import { NextResponse, after, type NextRequest } from "next/server";
import { authorizedInternal } from "@/lib/server/cron-auth";
import { getDb } from "@/lib/server/db";
import { STEP_SECONDS, callStep } from "@/lib/server/launch-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs one step of a launch (about 40 s of work), then calls itself for the next
 * one until the launch finishes. Answers at once; the work happens after the
 * response. A lease keeps two steps from ever working on the same launch.
 */
export async function POST(request: NextRequest) {
  if (!authorizedInternal(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad launch id" }, { status: 400 });
  const origin = process.env.APP_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;

  after(async () => {
    const db = getDb();
    if (!(await acquireLaunchLease(db, id, STEP_SECONDS + 15))) return;
    let again = false;
    try {
      const result = await runLaunch(db, storageFromEnv(), id, { deadline: Date.now() + STEP_SECONDS * 1000 });
      again = result.status === "running";
    } catch (e) {
      // Rate limits and timeouts: the cron picks the launch up again in a few minutes.
      console.error("launch step failed", e instanceof Error ? e.message : e);
    } finally {
      await releaseLaunchLease(db, id);
    }
    if (again) await callStep(origin, id);
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
