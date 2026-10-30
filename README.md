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

For plain Postgres instead of Supabase, apply `packages/db/supabase-shim.sql` once
before migrating. It adds the `auth` schema and roles that Supabase normally provides.
Never run the shim against a Supabase project.

The seed signs nobody in: it creates four team members (owner, admin, buyer, viewer)
at `@example.com` addresses, with fixed IDs listed in `packages/db/src/seed.ts`.

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
- [ ] 4. Settings → Meta connections
- [ ] 5. Sync and insights workers, Ads table
- [ ] 6. Dashboard
- [ ] 7. Creatives library and upload pipeline
- [ ] 8. Presets, naming and ad set templates
- [ ] 9. Launch builder and runner
- [ ] 10. Launch log
- [ ] 11. Guardrails, approvals, kill switch, alerts
- [ ] 12. Polish pass
