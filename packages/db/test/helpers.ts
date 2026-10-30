import { sql } from "drizzle-orm";
import { createTestDb as createBaseTestDb } from "../src/testing";
import { withUser } from "../src/with-user";

export const TODAY = "2026-10-30";

export async function createTestDb({ seeded = true } = {}) {
  return createBaseTestDb({ seeded, today: TODAY });
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
