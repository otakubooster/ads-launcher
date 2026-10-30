import { defineConfig } from "drizzle-kit";

/**
 * Migrations need a session connection. Supabase's pooler serves transaction mode on
 * 6543 (what the app uses) and session mode on 5432 of the same host, so one
 * DATABASE_URL works for both.
 */
function sessionUrl(url = "") {
  return url.replace(/(pooler\.supabase\.com):6543\//, "$1:5432/").replace(/[?&]pgbouncer=true/, "");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
  dbCredentials: { url: sessionUrl(process.env.DATABASE_URL) },
  strict: true,
  verbose: true,
});
