import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/schema";
import { seed } from "../src/seed";
import { withUser } from "../src/with-user";

export const TODAY = "2026-10-30";

/** In-memory Postgres with the Supabase shim, every migration and the seed. */
export async function createTestDb({ seeded = true } = {}) {
  const client = new PGlite();
  await client.exec(readFileSync(fileURLToPath(new URL("../supabase-shim.sql", import.meta.url)), "utf8"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  if (seeded) await seed(db, { today: TODAY });
  return db;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
type Tx = Parameters<Parameters<TestDb["transaction"]>[0]>[0];
type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

class Rollback<T> extends Error {
  constructor(readonly value: T) {
    super("rollback");
  }
}

function messageOf(e: unknown): string {
  const err = e as { message?: string; cause?: unknown };
  return err.cause ? messageOf(err.cause) : String(err.message ?? e);
}

async function rollingBack<T>(run: (fn: (tx: Tx) => Promise<never>) => Promise<unknown>, fn: (tx: Tx) => Promise<T>) {
  try {
    await run(async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return { ok: true, value: e.value as T } satisfies Outcome<T>;
    return { ok: false, error: messageOf(e) } satisfies Outcome<T>;
  }
  throw new Error("unreachable");
}

/** Runs fn as a signed-in member under RLS, then rolls back whatever it did. */
export function asUser<T>(db: TestDb, userId: string, fn: (tx: Tx) => Promise<T>): Promise<Outcome<T>> {
  return rollingBack((inner) => withUser(db, userId, inner), fn);
}

/** Runs fn as Supabase's service_role (bypasses RLS), then rolls back. */
export function asServiceRole<T>(db: TestDb, fn: (tx: Tx) => Promise<T>): Promise<Outcome<T>> {
  return rollingBack(
    (inner) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role service_role`);
        return inner(tx);
      }),
    fn,
  );
}
