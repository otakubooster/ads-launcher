import type * as schema from "@fahd/db/schema";
import type { PgDatabase } from "drizzle-orm/pg-core";

/** Any Drizzle Postgres database or transaction over our schema (postgres-js, PGlite). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PgDatabase<any, typeof schema>;
