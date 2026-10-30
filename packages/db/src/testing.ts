import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import { seed } from "./seed";

/** In-memory Postgres with the Supabase shim and every migration, optionally seeded. Tests only. */
export async function createTestDb({ seeded = true, minimal = false, today = "2026-10-30" } = {}) {
  const client = new PGlite();
  await client.exec(readFileSync(fileURLToPath(new URL("../supabase-shim.sql", import.meta.url)), "utf8"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  if (seeded) await seed(db, { today, minimal });
  return db;
}
