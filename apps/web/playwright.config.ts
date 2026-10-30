import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end runs need a Postgres server: E2E_DATABASE_URL names a database that
 * global-setup drops, migrates and seeds on every run. Meta is the fake Graph
 * server; sign-in is the development picker.
 */
const PORT = 3100;
const GRAPH_PORT = 4011;
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:54329/fahd_e2e";

export const E2E_ENV = {
  DATABASE_URL: databaseUrl,
  DEV_AUTH: "1",
  META_GRAPH_HOST: `http://127.0.0.1:${GRAPH_PORT}`,
  META_APP_SECRET: "e2e-secret",
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
  FX_RATES: '{"EUR":1.08,"GBP":1.27}',
  REPORTING_CURRENCY: "USD",
  // Empty: no worker runs in e2e, so syncs and launches run inline.
  REDIS_URL: "",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: "pnpm --filter @fahd/meta fake",
      url: `http://127.0.0.1:${GRAPH_PORT}/__fake/state`,
      env: { FAKE_GRAPH_PORT: String(GRAPH_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `pnpm dev --port ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      env: E2E_ENV,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
