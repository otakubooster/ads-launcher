import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Privileged connection (table owner; RLS does not apply). Use it in the worker
 * and for system writes. Anything a signed-in member triggers goes through
 * withUser() so RLS is enforced as well as the server-side checks.
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare: false keeps it compatible with Supabase's transaction pooler.
  const client = postgres(url, { prepare: false, max: 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
