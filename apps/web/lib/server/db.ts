import "server-only";
import { createDb, withUser, type Db } from "@fahd/db";

const globalForDb = globalThis as unknown as { __db?: Db };

/** Privileged connection: system writes only. Member-triggered work goes through asUser(). */
export function getDb(): Db {
  globalForDb.__db ??= createDb();
  return globalForDb.__db;
}

/** Runs fn as the member under RLS ("enforce every row twice"). */
export function asUser<T>(userId: string, fn: Parameters<typeof withUser<Db, T>>[2]) {
  return withUser(getDb(), userId, fn);
}
