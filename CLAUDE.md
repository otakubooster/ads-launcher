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
- `pnpm db:migrate` is added in session 2.
