# Fahd Ads Launcher

Read docs/spec.md before every task. It is the source of truth.

## Stack
Next.js App Router + TypeScript (strict), Tailwind + shadcn/ui, Radix Colors,
TanStack Table/Query/Virtual, Recharts, Supabase (Postgres, Auth, Storage, Realtime),
Drizzle ORM, BullMQ + Redis worker, pnpm workspaces, Vitest, Playwright.

## Rules
- All Meta calls go through packages/meta. Never call graph.facebook.com anywhere else.
- Every Meta create uses status PAUSED.
- Never log, return or send access tokens to the browser. Decrypt only in server code.
- Every write to Meta appends a change_log row (before, after, Meta response).
- Throttle: one queue per ad account, concurrency 1, max 2 writes/s, pause at 75% usage.
- Max 3 retries. Never retry validation (100) or permission (10, 200, 294) errors.
- Money is stored in minor units (cents); format only in the UI.
- UI follows the design system: Radix slate + iris, Inter with tabular numbers,
  13px table text, 40px rows, 1px borders, shadows only on floating layers.
- Every screen ships loading (skeleton), empty and error states, in light and dark.

## Commands
pnpm dev · pnpm worker · pnpm db:migrate · pnpm test · pnpm e2e · pnpm lint

## Definition of done
Types, lint and tests pass. The feature works against the test ad account with
everything created paused. Screens checked in light and dark against the spec.

## Implementation notes (kept up to date by each session)
- Design tokens live in apps/web/app/globals.css. The Tailwind default palette, type
  scale and radii are reset; only Radix scales (slate, iris, grass, red, amber, blue)
  and the spec's named sizes exist: text-label 12, text-ui 13, text-body 14,
  text-section 16, text-title 20, text-kpi 28; rounded-control 6, rounded-card 8,
  rounded-dialog 12; shadow-float for floating layers only.
- shadcn-style components are hand-written in apps/web/components/ui on the
  `radix-ui` package. Keep new ones on the same tokens.
- Navigation and keyboard shortcuts are defined once in apps/web/lib/nav.ts.
- Number, money and date formatting: apps/web/lib/format.ts and lib/date-range.ts.
- Database (packages/db): Drizzle schema in src/schema, one file per domain. RLS
  policies sit next to each table, built from helpers in src/schema/_shared.ts
  (membersCanRead, rolesCanWrite, hasRole). Shared column sets are factories
  (`...base()`), because Drizzle column builders must not be shared between tables.
- Migrations: change the schema, then `pnpm db:generate`. Functions, triggers, views and
  grants go in hand-written migrations (`drizzle-kit generate --custom`): 0000 holds the
  `app.*` helpers policies call; 0002 holds triggers, column grants and metric views.
- Two ways to query: `createDb()` is privileged (worker and system writes, no RLS);
  `withUser(db, userId, fn)` runs as Supabase's `authenticated` role, so RLS applies.
  Use withUser for everything a signed-in member triggers.
- meta_connections.token_ciphertext / token_iv are not selectable by `authenticated`.
  Never `.returning()` all columns from that table inside withUser.
- ad_accounts: members may only update max_daily_budget, approval_threshold and
  launch_enabled (column grants); everything else comes from Meta sync.
- change_log is append-only for every role (trigger), the service role included.
- Metric views (ad/adset/campaign/account_insights_daily) sum before dividing;
  CPA and CPM come out in minor units, and division by zero gives null.
- Meta (packages/meta): `createMetaClient({ accessToken, appSecret, onUsage })` is the only
  way to call Graph. It sends the token as a Bearer header (never in URLs or logs), signs
  with appsecret_proof, parses usage headers, retries per the spec and throws
  MetaApiError (kind, code, userTitle/userMessage, retryAfterMs, ambiguous).
  describeMetaError() gives UI copy (title, detail, fix).
- The client refuses any create (campaigns, adsets, ads, copies) that is not PAUSED,
  including inside batches. Activation is a separate POST /{id} with status ACTIVE.
- Throttle (packages/meta/src/throttle.ts) is per process. The worker must also use one
  BullMQ queue per ad account with concurrency 1, and feed onUsage into api_usage.
- A write that times out is `ambiguous`: look the object up by name before retrying.
- Meta tests replay fixtures in packages/meta/test/fixtures (Meta's response format)
  with a fake clock; CI never calls Meta.
- packages/core holds the Meta ↔ database services both the web app and the worker use
  (clientForConnection, syncConnectionAssets, verifyConnection, …). Pass it a privileged
  db; check the member's role in the caller first.
- Auth (apps/web/lib/server/auth.ts): Supabase email + password with TOTP (aal2) for
  owners and admins; DEV_AUTH=1 swaps in a seeded-member picker outside production.
  Pages call requireSession(); server actions call requireRole(...) and then write
  through asUser() so RLS checks the same rule again. Wrap actions in runAction() for
  {ok, message} / {ok: false, error: {title, detail, fix}} results.
- meta_assets (pages, Instagram accounts, pixels) is the one table beyond the spec's
  data model; new tables need the updated_at trigger in a custom migration (see 0004).
- Fake Graph API (packages/meta/src/testing/fake-graph.ts, `pnpm fake-meta`): stateful,
  Meta's response format, forced errors via POST /__fake/fail. META_GRAPH_HOST points the
  client at it; ignored in production.
- E2E: Playwright starts the fake Graph server and `next dev` with DEV_AUTH; global-setup
  recreates E2E_DATABASE_URL. Use e2e/helpers.ts signIn() and ensureConnected().
- Worker (apps/worker): one BullMQ queue per ad account (`account-<uuid>`, concurrency 1,
  limiter 2/s). Scheduler jobs: tick every 15 min (objects + today's insights), assets daily,
  28-day async backfill nightly. processAccountJob() maps Meta errors: auth marks the
  connection broken, final kinds throw UnrecoverableError, rate limits back off by
  retryAfterMs. Without REDIS_URL the web app runs syncs inline (dev, e2e).
- Ads table: data from lib/server/ads.ts (sums per range in SQL; ratios in lib/metrics.ts,
  same definitions as the views). Scope and dates live in the URL (lib/filters.ts); selection
  on campaigns/ad sets is the `campaigns` / `adsets` param that filters the next level.
  Rows are memoized and virtualized; keep per-row components light (RowSwitch, no Radix
  tooltips in rows).
- Drizzle spreads JS arrays into ($1, $2…); pass uuid lists as one '{…}'::uuid[] literal
  (see anyOf in lib/server/ads.ts).
- Every Meta write from the UI goes through `logged()` in app/(app)/ads/actions.ts or the
  same pattern: one change_log row with before, after and Meta's response, also on failure.
- DB tests run on PGlite (in-memory Postgres) with supabase-shim.sql; test/helpers.ts
  has asUser / asServiceRole, which always roll back. No database server needed.
