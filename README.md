# Fahd Ads Launcher

Launch, monitor and control Meta ads without opening Ads Manager.
The full build spec is [docs/spec.md](docs/spec.md); working rules for Claude Code are in [CLAUDE.md](CLAUDE.md).

## Getting started

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev          # web app on http://localhost:3000
pnpm worker       # background worker (no queues yet)
```

## Database

The app targets Supabase (Postgres 15+). Point `DATABASE_URL` at a Supabase project, or
run one locally with the [Supabase CLI](https://supabase.com/docs/guides/local-development)
(`supabase start`), then:

```bash
pnpm db:migrate   # apply migrations in packages/db/migrations
pnpm db:seed      # fictional brands, accounts, 28 days of metrics (local databases only)
```

Create a **private** Storage bucket named `creatives` and raise the project's upload size
limit to at least 1 GB (Storage → Settings), so 500 MB videos fit. Browsers upload straight
to the bucket through signed URLs; Meta fetches videos from signed read URLs.

For plain Postgres instead of Supabase, apply `packages/db/supabase-shim.sql` once
before migrating. It adds the `auth` schema and roles that Supabase normally provides.
Never run the shim against a Supabase project.

The seed signs nobody in: it creates four team members (owner, admin, buyer, viewer)
at `@example.com` addresses, with fixed IDs listed in `packages/db/src/seed.ts`.

## Local development without Meta or Supabase

The app runs end to end against a fake Graph API and development sign-in:

```bash
pnpm db:migrate && pnpm db:seed --minimal   # team, brands, templates; no Meta data
pnpm fake-meta                              # fake Graph API on :4010
pnpm worker                                 # BullMQ worker (REDIS_URL); optional locally
pnpm dev                                    # with DEV_AUTH=1 and META_GRAPH_HOST in apps/web/.env.local
```

Sign in as Fahd (owner), open Settings → Add connection, and use Business ID
`100000000000001` with any token starting `EAAFAKE`. `pnpm e2e` does the same against a
throwaway database (`E2E_DATABASE_URL`, default `postgres://postgres@localhost:54329/fahd_e2e`).

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js app: UI and server actions |
| `apps/worker` | Long-running jobs: sync, insights, upload, launch |
| `packages/db` | Drizzle schema, migrations, RLS, SQL views |
| `packages/meta` | Typed Graph API client, error map, throttle |
| `packages/shared` | Zod schemas, types, naming-template engine |

## Build progress

Sessions follow *Claude Code playbook → Session order* in the spec.

- [x] 1. Monorepo, design tokens, light and dark themes, app shell, ⌘K
- [x] 2. Drizzle schema, RLS, metric views, seed data
- [x] 3. `packages/meta` client, headers, error map, throttle
- [x] 4. Settings → Meta connections
- [x] 5. Sync and insights workers, Ads table
- [x] 6. Dashboard
- [x] 7. Creatives library and upload pipeline
- [ ] 8. Presets, naming and ad set templates
- [ ] 9. Launch builder and runner
- [ ] 10. Launch log
- [ ] 11. Guardrails, approvals, kill switch, alerts
- [ ] 12. Polish pass
