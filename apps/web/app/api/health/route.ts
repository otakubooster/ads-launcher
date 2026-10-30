/** Liveness for deploys and test runners; touches no database. */
export function GET() {
  return Response.json({ ok: true });
}
