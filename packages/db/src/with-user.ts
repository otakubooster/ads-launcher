import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgDatabase = PgDatabase<any, any>;
type TxOf<TDb extends AnyPgDatabase> = Parameters<Parameters<TDb["transaction"]>[0]>[0];

/**
 * Runs `fn` in a transaction as Supabase's `authenticated` role with
 * auth.uid() = userId, so every query is checked by RLS.
 */
export async function withUser<TDb extends AnyPgDatabase, T>(
  db: TDb,
  userId: string,
  fn: (tx: TxOf<TDb>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx as TxOf<TDb>);
  }) as Promise<T>;
}
