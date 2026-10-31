import "server-only";
import { runLaunch, storageFromEnv } from "@fahd/core";
import { headers } from "next/headers";
import { after } from "next/server";
import { getDb } from "./db";

/** Seconds a step may work before handing over (Vercel stops functions at 60). */
export const STEP_SECONDS = 40;

/** Asks the step endpoint to run (the next step of) a launch, without waiting for it. */
export async function callStep(origin: string, launchId: string) {
  await fetch(`${origin}/api/launch/step?id=${launchId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).catch((e) => console.error("launch step call failed", e));
}

async function selfOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/**
 * Starts a launch without the worker. With CRON_SECRET (Vercel) it runs in steps
 * through /api/launch/step, each well inside the function time limit; without it
 * (local development) it runs in one go after the response.
 */
export async function kickLaunch(launchId: string) {
  if (process.env.CRON_SECRET) {
    const origin = await selfOrigin();
    after(() => callStep(origin, launchId));
    return;
  }
  after(() => runLaunch(getDb(), storageFromEnv(), launchId).catch((e) => console.error("launch failed", e)));
}
