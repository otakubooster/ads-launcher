import { appVersion } from "@/lib/version";

/** Liveness for deploys and test runners; touches no database. Also says which commit is live. */
export function GET() {
  return Response.json({ ok: true, version: appVersion().commit });
}
