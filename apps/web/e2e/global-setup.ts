import { readFileSync } from "node:fs";
import path from "node:path";
import { seed } from "@fahd/db";
import * as schema from "@fahd/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { E2E_ENV } from "../playwright.config";

/** Recreates the e2e database: Supabase shim, every migration, minimal seed. */
export default async function globalSetup() {
  const url = new URL(E2E_ENV.DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/e2e|test/.test(name)) throw new Error(`Refusing to reset "${name}": the e2e database name must contain e2e or test`);
  const admin = postgres({ ...pgOptions(url), database: "postgres" });
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end();

  const client = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => {} });
  // Playwright runs from apps/web and loads this file as CommonJS (no import.meta).
  const dbDir = `${path.resolve(process.cwd(), "../../packages/db")}/`;
  await client.unsafe(readFileSync(`${dbDir}supabase-shim.sql`, "utf8"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: `${dbDir}migrations` });
  await seed(db, { minimal: true });
  await client.end();
}

function pgOptions(url: URL) {
  return { host: url.hostname, port: Number(url.port || 5432), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) || undefined, onnotice: () => {} };
}
