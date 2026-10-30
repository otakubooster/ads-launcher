# Fahd Ads Launcher — Build Spec

Oct 30, 2026 · @Fahd

## Overview & scope

Fahd Ads Launcher is a web app for launching, monitoring and controlling Meta ads without opening Ads Manager. Version 1 covers Meta only, for ad accounts inside your own Business Manager(s).

**Who uses it**

| Role | Can do |
| --- | --- |
| Owner | Everything, including Meta connection, team, spend limits |
| Admin | Everything except billing and deleting the workspace |
| Media buyer | Launch, pause, activate and edit budgets within limits |
| Viewer | Read-only dashboards and launch logs |

**Version 1 must do**

1. Show every brand's campaigns, ad sets and ads in one Ads Manager-style table with live metrics.
2. Pause, activate and change budgets inline, with a confirm step.
3. Bulk-launch ads from a folder of creatives plus a copy sheet, into new or existing ad sets, always created paused.
4. Save brand × market presets: ad account, Facebook page, Instagram account, pixel, domain, UTMs, naming.
5. Clone settings from a winning ad set, or reuse an existing post by Post ID to keep its social proof.
6. Log every launch and every change, with who made it.

**Not in version 1:** TikTok and Google, automated rules, client accounts owned by other businesses (needs Meta App Review), creative generation, Shopify-based true ROAS. These sit in the backlog at the end.

**Assumptions:** every ad account is owned by, or shared into, your Business Manager(s). One Meta developer app serves all of them, with one system user token per Business Manager.

## Meta setup checklist

One Meta developer app plus one system user per Business Manager gives the app permanent, server-side access. A Business Manager admin does this once, by hand, in about an hour.

1. **Create the app.** At developers.facebook.com, create an app of type **Business** and link it to the main Business Manager.
2. **Add the Marketing API product** to the app. Facebook Login for Business is only needed later, for client-owned accounts.
3. **Create a system user.** Business Settings → Users → System users → Add. Name it `fahd-ads-launcher`, role **Admin**.
4. **Assign assets to the system user**, each with full control:
   1. Every ad account the tool should manage.
   2. Every Facebook page and Instagram account ads run from.
   3. Every pixel / dataset, and catalogs if used.
5. **Connect the app to the system user.** Business Settings → Accounts → Apps → select the app → assign the system user.
6. **Generate the token.** Select the app, set expiry to **Never**, and tick: `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `pages_manage_metadata`, `instagram_basic`. Add `catalog_management` only if catalog ads are planned.
7. **Store the token in the app, not in code.** Paste it into Settings → Meta connection. The server encrypts it at rest. It never goes in Git, `.env` files committed to Git, or the browser.
8. **Repeat steps 3–7 for each extra Business Manager**, after adding the same app to that Business Manager.
9. **Request Full access to the Marketing API access tier** in App Review once the app works. New apps start on a limited tier of 300 + 40 × active ads calls per ad account per hour; Full access raises the base to 100,000 ([Meta rate limiting](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting)).

**Later, for client accounts:** add Facebook Login for Business and pass App Review for advanced access on `ads_management` and `business_management`. Not needed while every account sits in your own Business Managers.

## Architecture & tech stack

A Next.js web app handles the UI and quick edits; a separate always-on worker runs every slow Meta job through per-account queues.

&#91;embedded content: system architecture · 6 parts\]

Meta fetches each video straight from Storage through a one-hour signed URL, so large files never pass through the web app.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js (App Router), TypeScript strict | Server actions keep the token server-side |
| UI kit | Tailwind CSS, shadcn/ui, Radix Colors, Lucide icons | Professional look out of the box, full control |
| Tables and data | TanStack Table, Virtual, Query | Fast, sortable, virtualised ads table |
| Charts | Recharts through shadcn charts | Simple and themeable |
| Database, auth, files | Supabase: Postgres, Auth, Storage, Realtime | One service for data, login, files and live updates |
| ORM | Drizzle | Typed schema and migrations in Git |
| Jobs | BullMQ on Redis | Per-account queues with concurrency 1 and rate limits |
| Worker host | Railway (or Fly.io) | Long uploads with no serverless timeouts |
| Web host | Vercel | Zero-config Next.js |
| Email | Resend | Alert emails |
| Monitoring | Sentry | Errors from web and worker |

## Data model

Nineteen Postgres tables cover connections, presets, media, launches, a local mirror of Meta objects, metrics and an audit trail. Every table also has `id`, `created_at` and `updated_at`.

| Table | Key columns | Purpose |
| --- | --- | --- |
| `users` | email, name, role (owner / admin / buyer / viewer), max\_budget\_change\_pct | Login and permissions |
| `meta_connections` | business\_id, business\_name, token\_ciphertext, token\_iv, token\_last4, scopes\[\], status, last\_verified\_at | One per Business Manager; token encrypted |
| `ad_accounts` | meta\_id (`act_…`), connection\_id, name, currency, timezone, account\_status, max\_daily\_budget, approval\_threshold, launch\_enabled | Synced from Meta; last three are our guardrails |
| `brands` | name, logo\_url, default\_domain | Groups presets and creatives |
| `presets` | brand\_id, market (country code), language, ad\_account\_id, page\_id, instagram\_user\_id, pixel\_id, conversion\_event, link\_url, url\_tags, default\_cta, creative\_features (JSON), naming\_template\_id, adset\_template\_id | The one-click "where does this ad go" bundle |
| `naming_templates` | level (campaign / ad set / ad), pattern | Tokens: `{brand}` `{market}` `{angle}` `{hook}` `{format}` `{date}` `{n}` |
| `adset_templates` | name, source\_adset\_id, spec (JSON: optimization goal, billing event, bid strategy, budget, targeting, attribution) | Saved by cloning a winning ad set |
| `creatives` | brand\_id, file\_name, storage\_path, kind (image / video), width, height, ratio (9:16, 4:5, 1:1, 16:9), duration\_s, size\_bytes, sha256, thumbnail\_path, group\_key, tags (angle, hook, format, language) | Media library; `group_key` = filename stem, used to pair ratios |
| `creative_uploads` | creative\_id, ad\_account\_id, image\_hash or video\_id, status (queued / uploading / processing / ready / error), error | Meta media lives per ad account, so one row per account |
| `copy_sets` | brand\_id, language, name, primary\_texts\[\], headlines\[\], descriptions\[\], cta\_type | Reusable copy; max 5 texts per type |
| `launches` | preset\_id, created\_by, mode (new campaign / existing campaign / existing ad set), structure (JSON), status (draft / queued / running / done / partial / failed), started\_at, finished\_at | One row per Launch click |
| `launch_items` | launch\_id, level (campaign / ad set / creative / ad), parent\_item\_id, payload (JSON), meta\_id, status, attempts, error\_code, error\_message, idempotency\_key | One row per object to create; the job runner walks this tree |
| `meta_campaigns` · `meta_adsets` · `meta_ads` | meta\_id, parent ids, name, status, effective\_status, budgets, creative\_id, thumbnail\_url, raw (JSON), synced\_at | Local mirror so the table loads instantly |
| `insights_daily` | ad\_id, date, spend, impressions, clicks, purchases, purchase\_value, video\_3s\_plays, thruplays | One row per ad per day; CTR, CPM, CPA, ROAS, hook rate and hold rate computed in SQL views |
| `change_log` | actor\_id, source (ui / claude / system), entity\_level, entity\_id, action, before (JSON), after (JSON), meta\_response | Append-only audit trail |
| `saved_views` | user\_id, level, columns\[\], filters (JSON), sort | Column presets and saved filters |
| `api_usage` | ad\_account\_id, recorded\_at, acc\_util\_pct, call\_count, total\_cputime, total\_time, tier | From Meta's rate-limit headers; drives throttling and the usage meter |

**Relationships:** a brand has many presets; a preset points to one ad account, page, Instagram account and pixel. A launch owns a tree of launch items (campaign → ad sets → creatives → ads). A creative has one upload row per ad account it is used in.

**Row-level security:** viewers can only `select`; buyers can insert launches and change-log rows; only owners and admins can touch `meta_connections` and guardrail columns.

## Meta Marketing API integration

All Meta traffic goes through one server-side client pinned to v26.0, with throttling, batching, idempotency and logging built in. The browser never calls Meta directly.

### Version and client

- Pin `META_API_VERSION=v26.0`, the latest Graph API version, released July 29, 2026 ([changelog](https://developers.facebook.com/docs/graph-api/changelog/version26.0)).
- Marketing API versions live about one year: v24.0 shipped October 8, 2025 and expires October 6, 2026 ([Marketing API changelog](https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog)). Plan one version upgrade per year.
- Use a thin typed `fetch` client (`lib/meta/client.ts`), not a heavy SDK, so a version bump is one constant.
- Every call: attach the token server-side, parse rate-limit headers, write an `api_usage` row, map errors, return typed results.

### Read and sync

| Purpose | Call | Schedule |
| --- | --- | --- |
| Ad accounts | `GET /{business_id}/owned_ad_accounts` and `/client_ad_accounts`, fields `id,name,currency,timezone_name,account_status,amount_spent` | On connect, then daily |
| Pages · Instagram · pixels | `GET /{business_id}/owned_pages`, `GET /act_{id}/instagram_accounts`, `GET /act_{id}/adspixels` | On connect, then daily |
| Campaigns · ad sets · ads | `GET /act_{id}/campaigns`, `/adsets`, `/ads` with `limit=200`, paged; fields include `status,effective_status,daily_budget,lifetime_budget,bid_strategy,creative{thumbnail_url}` | Every 15 min + Refresh button |
| Today's metrics | `GET /act_{id}/insights?level=ad&time_increment=1&date_preset=today` | Every 15 min |
| Backfill | Async: `POST /act_{id}/insights` → `report_run_id` → poll `GET /{report_run_id}` until `Job Completed` → `GET /{report_run_id}/insights` | Nightly, last 28 days |

Insights fields: `ad_id,adset_id,campaign_id,spend,impressions,inline_link_clicks,actions,action_values,video_thruplay_watched_actions`. Request `action_attribution_windows=['7d_click','1d_view']`; Meta retired the 7-day and 28-day view windows.

**Metric definitions (computed in SQL):**

- Purchases = `actions` where `action_type = purchase`; purchase value from `action_values`.
- CPA = spend ÷ purchases. ROAS = purchase value ÷ spend.
- CTR (link) = inline link clicks ÷ impressions. CPM = spend ÷ impressions × 1,000.
- Hook rate = 3-second video plays (`actions` → `video_view`) ÷ impressions.
- Hold rate = ThruPlays ÷ impressions.

### Media upload

Meta media belongs to one ad account, so each file is uploaded once per account and the result cached in `creative_uploads` (deduped by sha256).

- **Images:** `POST /act_{id}/adimages` with the file → store `images.<name>.hash`.
- **Videos:** `POST /act_{id}/advideos` with `file_url` = a signed storage URL valid for 1 hour. Fallback: chunked upload with `upload_phase=start` (send `file_size`) → `transfer` chunks at the offsets Meta returns → `finish` ([reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/advideos)).
- **Wait for processing:** poll `GET /{video_id}?fields=status` every 10 s until `video_status = ready`; time out after 20 min. Then read `GET /{video_id}/thumbnails` and keep the preferred one.
- A video is never attached to an ad before it is ready. This is the most common launch failure.

### Create objects (always `status: PAUSED`)

1. **Campaign** — `POST /act_{id}/campaigns`: `name`, `objective: OUTCOME_SALES`, `special_ad_categories: []`, `status: PAUSED`, and for campaign budget `daily_budget` + `bid_strategy`. Budgets are in the account currency's minor unit (cents).
2. **Ad set** — `POST /act_{id}/adsets`: `campaign_id`, `optimization_goal: OFFSITE_CONVERSIONS`, `billing_event: IMPRESSIONS`, `promoted_object: {pixel_id, custom_event_type: PURCHASE}`, `targeting: {geo_locations: {countries: [...]}, targeting_automation: {advantage_audience: 1}}`, `attribution_spec`, `daily_budget` if ad-set budgets, `status: PAUSED`.
3. **Clone a winning ad set** instead — `POST /{adset_id}/copies` with `deep_copy: false`, `status_option: PAUSED`, target `campaign_id`; then rename.
4. **Creative** — `POST /act_{id}/adcreatives`:
   1. `object_story_spec: {page_id, instagram_user_id, video_data | link_data}`. `instagram_user_id` replaced `instagram_actor_id` from v22.0 ([Meta blog](https://developers.facebook.com/blog/post/2025/08/11/instagram-marketing-api-update/)).
   2. Different file per placement (9:16 for Stories/Reels, 4:5 for Feed): `asset_feed_spec` with both videos labelled, plus `asset_customization_rules`, at least two rules ([asset feed spec](https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/)).
   3. `degrees_of_freedom_spec.creative_features_spec`: set every Advantage+ creative feature to `OPT_IN` or `OPT_OUT` from the preset; the old `standard_enhancements` bundle is gone since v22.0 ([guide](https://developers.facebook.com/docs/marketing-api/creative/advantage-creative/get-started)).
   4. `url_tags`: `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`.
   5. **Reuse a post** to keep its likes and comments: `object_story_id: "<page_id>_<post_id>"` instead of `object_story_spec`.
5. **Ad** — `POST /act_{id}/ads`: `name`, `adset_id`, `creative: {creative_id}`, `status: PAUSED`.
6. **Preview** — `GET /{creative_id}/previews?ad_format=INSTAGRAM_REELS` (also `MOBILE_FEED_STANDARD`, `INSTAGRAM_STANDARD`, `FACEBOOK_STORY_MOBILE`) returns an iframe for the review screen.
7. **Activate or edit** — `POST /{id}` with `status: ACTIVE | PAUSED` or a new `daily_budget`. Write `change_log` before and after.

**Advantage+ sales:** the legacy `smart_promotion_type` route is closed. A campaign shows as Advantage+ sales when it uses `OUTCOME_SALES` with campaign budget, Advantage+ audience and Advantage+ placements all enabled; confirm by reading `advantage_state_info` ([Meta guide](https://developers.facebook.com/documentation/ads-commerce/marketing-api/advantage-campaigns)).

**Flexible ads (phase 2):** `creative_asset_groups_spec` on the ad, `OUTCOME_SALES` only, at most 5 texts per type ([guide](https://developers.facebook.com/documentation/ads-commerce/marketing-api/flexible-ad-format)).

**Batching:** send creatives and ads through the Graph batch endpoint (`POST /` with `batch=[…]`, up to 50 requests), chaining each ad to its creative with `{result=<name>:$.id}`.

### Rate limits and throttling

Meta limits calls per ad account per hour and reports usage in response headers: `X-Ad-Account-Usage` (`acc_id_util_pct`, `reset_time_duration`, `ads_api_access_tier`) and `X-Business-Use-Case-Usage` (`call_count`, `total_cputime`, `total_time`, `estimated_time_to_regain_access`) ([Meta](https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/rate-limiting)).

- One write queue per ad account, one request in flight, at most 2 writes per second.
- Any usage value at or above 75% → pause that account's queue until `estimated_time_to_regain_access` or `reset_time_duration` passes.
- Multi-account launches run account by account, never in parallel.
- Never more than 3 retries for any request; never retry a validation error.

### Error handling

| Error code | Meaning | Action |
| --- | --- | --- |
| 4, 17, 613, 80000–80014 | Rate limited | Back off per headers, retry up to 3 times |
| 1, 2 | Temporary Meta error | Retry twice: after 2 s, then 8 s |
| 190 | Token invalid or expired | Stop all jobs, mark connection broken, alert owner |
| 10, 200, 294 | Missing permission | Stop, show which permission and asset to fix |
| 100 | Invalid parameter | No retry; show Meta's `error_user_title` + `error_user_msg` |
| 368 | Account blocked for policy | Stop the whole launch, alert owner |

**Idempotency:** every `launch_item` has a key. After a timeout, look the object up by name under its parent before creating it again, so a retry never doubles an ad.

## Screens & UX flows

Nine screens, built around two jobs: read performance fast in an Ads Manager-style table, and launch a batch of ads in under five minutes. Every spend-changing action goes through a confirm step and the change log.

### App shell

- **Sidebar** (240 px, collapses to a 64 px icon rail): Dashboard, Ads, Launch, Creatives, Copy, Launch log, Presets, Settings. API usage meter and user menu pinned at the bottom.
- **Top bar** (56 px): scope switcher (Brand ▸ Market ▸ Ad account, multi-select, "All accounts"), date range with compare-to-previous toggle, attribution chip, sync status ("Synced 2 min ago" + refresh).
- **Command palette** (⌘K): jump to any campaign, ad set, ad, creative or preset by name; run actions ("New launch", "Pause selected", "Open launch log").
- **Keyboard:** `J`/`K` move rows, `X` select, `Shift+click` range select, `/` focus filter, `G` then `D`/`A`/`L` to go to Dashboard/Ads/Launch, `⌘Enter` confirm dialogs, `Esc` close drawers.

### 1. Dashboard

- Six KPI cards: Spend, Purchases, CPA, ROAS, CTR, CPM. Each shows the value, change vs previous period, and a 14-day sparkline. Colour follows the metric's good direction (CPA down = green).
- Main chart: daily spend as bars with ROAS as a line; metric switcher.
- Top creatives: 8 thumbnails ranked by spend, each with ROAS and hook rate; click opens the ad drawer.
- Alerts: rejected ads, account issues, launches with errors, token problems, accounts near their spend guardrail.
- Accounts strip: one row per ad account with today's spend, CPA, ROAS and status.

### 2. Ads (the Ads Manager table)

- **Level tabs:** Campaigns · Ad sets · Ads. Selecting rows on one level filters the next, as in Meta's Ads Manager; a chip shows "3 selected" with clear.
- **Toolbar:** search, filter chips (status, brand, market, account, spend, ROAS, CPA ranges), column preset (Performance, Creative, Delivery, Custom), saved views, density toggle, CSV export.
- **Table rules:** sticky header and sticky first two columns (on/off toggle + name); 40 px rows (32 px compact); numbers right-aligned in tabular figures; totals row pinned at the bottom; sortable, resizable, reorderable columns.
- **Delivery column:** status dot + text — Active, Learning, Learning limited, Paused, In review, Rejected, Not delivering.
- **Inline toggle:** pausing applies at once with an Undo toast; activating opens a confirm showing the daily budget it releases.
- **Inline budget edit:** click the budget → popover with input, quick buttons (−20%, −10%, +10%, +20%), the new account daily total, and a warning when a guardrail would be crossed.
- **Row hover actions:** open drawer, duplicate, copy ID, open in Meta.
- **Bulk action bar** (slides up when rows are selected): Pause, Activate, Budget ±%, Duplicate, Rename by template, Add to launch.
- **Detail drawer** (right, 480 px): name, status toggle, then tabs — Overview (daily chart + KPIs), Creative (placement previews), Settings (read-only targeting, optimization, budget), History (change log).

### 3. Launch builder

One page with a left stepper and a sticky right summary ("12 ads · 3 ad sets · $150/day · created paused"). Every change autosaves as a draft.

1. **Destination.** Pick a preset (brand × market); it fills ad account, page, Instagram account, pixel, link and UTMs. Choose: new campaign from a template, new ad sets in an existing campaign, or existing ad sets. Pick an ad set template or clone a live ad set by search. Set budget type and amount.
2. **Creatives.** Drop files or a folder, or pick from the library. Files sharing a stem pair automatically (`hook3_9x16.mp4` + `hook3_4x5.mp4` = one creative with two ratio badges); unpaired files show a warning. Per-file progress: uploading → processing → ready. Validation flags wrong ratio, low resolution, length and size. Tag each creative with angle and hook.
3. **Copy.** Pick a copy set or write: up to 5 primary texts, 5 headlines, description, CTA, link. Apply to all, or override per creative in a grid. Character counters and a live preview.
4. **Structure & naming.** Grouping: one ad set per creative, per angle, all in one, or N ads per ad set. Naming template with live examples. Advantage+ creative features as toggles, defaulted from the preset. Start: paused (default) or scheduled.
5. **Review.** A tree of everything to be created — campaign → ad sets → ads — with names, thumbnails, copy and placement mapping, each row validated. Phone-frame previews for Reels, Feed and Stories. Buttons: **Create paused** (primary) and **Create & activate** (secondary, confirm dialog with the new daily budget, owner/admin only).

After the click, the user lands on that launch's live log.

### 4. Launch log

- **List:** launch name, preset, who, when, status pill (Running 34/48, Done, Partial, Failed), counts.
- **Detail:** the same tree with a live status icon per item, Meta IDs with copy buttons, and errors inline in plain language with the suggested fix.
- **Actions:** Retry failed items, Activate all (when every item is done), Duplicate as new launch.

### 5. Creatives

- Card grid: thumbnail, ratio badges, duration, tags, and performance across every ad using it (spend, ROAS, hook rate).
- Filters: brand, tag, ratio, performance band, date added. Hover plays video previews muted.
- Select several → "Launch with selected". A creative's page lists every ad that uses it.

### 6. Copy

- Table of copy sets with language, brand, last used; edit in a side panel; duplicate to another language.

### 7. Presets

- Brands list → per-market preset cards: ad account, page, Instagram account, pixel, link, UTMs, CTA, naming template, ad set template, Advantage+ creative defaults.
- **Test preset** checks every ID against Meta and shows a green or red line per asset and permission.
- Naming template editor with token chips and a live example; ad set templates created by cloning a live ad set.

### 8. Settings

- **Meta connections:** one card per Business Manager — status, token last 4 characters, a check per required permission, last verified, Re-verify, Replace token.
- **Ad accounts:** launch-enabled toggle, max daily budget, approval threshold.
- **Team:** invite by email, roles.
- **API usage:** per-account usage bars from the rate-limit headers.

### 9. Claude panel (phase 2)

- Right-side panel (⌘J). Claude answers from the app's own data through read-only tools (query metrics, list ads, read launch logs).
- Any change Claude suggests appears as a proposed-change card; nothing runs until the user clicks Confirm, and it passes the same guardrails and change log.

### States every screen handles

- **Loading:** skeletons shaped like the final content, never spinners on full pages.
- **Empty:** one sentence and one primary action ("Connect Meta", "Create your first preset").
- **Error:** what failed, why, and the fix, with Meta's own `error_user_msg` where available.
- **Stale data:** a quiet banner when the last sync is over 30 minutes old.

## UI design system

The look is calm, dense and fast: a neutral grey interface, one accent colour, tabular numbers, and colour reserved for meaning. Light and dark themes ship from day one, following the system setting.

### Reference products

| Product | What to borrow |
| --- | --- |
| Meta Ads Manager | Level tabs, column presets, delivery statuses — buyers already know them |
| Linear | Density, keyboard-first flow, ⌘K palette, quiet neutral palette, quick transitions |
| Stripe dashboard | Data tables, number formatting, filter chips, detail drawers |
| Vercel dashboard | Typography, empty states, settings layout |
| Motion | Creative grid with performance on each card |
| Bulk ad launchers | Ratio auto-pairing, full review before anything is created |

### Colour

Use the [Radix Colors](https://www.radix-ui.com/colors) scales, which ship matched light and dark versions. Each scale has 12 steps with fixed jobs: 1–2 backgrounds, 3–5 component fills (normal, hover, pressed), 6–8 borders (subtle, normal, focus), 9–10 solid fills, 11–12 text.

| Role | Scale | Used for |
| --- | --- | --- |
| Neutral | `slate` | Backgrounds, surfaces, borders, text — 90% of the screen |
| Accent | `iris` | Primary buttons, selection, focus ring, the one highlighted chart series |
| Positive | `grass` | Active status, good deltas |
| Negative | `red` | Rejected, errors, bad deltas, destructive buttons |
| Warning | `amber` | Learning limited, not delivering, guardrail warnings |
| Info | `blue` | Learning, in review, processing |

Rules: page background `slate-1`, cards `slate-1` with a `slate-6` border, hover `slate-3`, selected row `iris-3`, body text `slate-12`, secondary text `slate-11`. Never colour a number unless it is a delta or a status.

### Typography

- **Font:** Inter for UI, with tabular figures (`font-variant-numeric: tabular-nums`) on every number. JetBrains Mono for IDs and code.
- **Scale (px / line height):** 12/16 labels and table headers · 13/20 table cells and default UI · 14/20 body and forms · 16/24 section titles · 20/28 page titles · 28/32 KPI values.
- **Weights:** 400 text, 500 labels and buttons, 600 titles and KPI values. Letter-spacing −0.01em at 20 px and above.
- **Copy:** sentence case, verbs on buttons ("Create paused", not "Submit"), no exclamation marks.

### Spacing, shape, depth

- 4 px grid; common steps 4, 8, 12, 16, 24, 32. Page padding 24 px (16 px on small screens).
- Radius: 6 px controls, 8 px cards, 12 px dialogs and drawers.
- 1 px borders do the separating; cards are flat. Shadows only on floating layers (popovers, menus, dialogs, toasts).
- Icons: Lucide, 16 px, 1.5 stroke; 20 px in empty states.

### Components

shadcn/ui on Radix primitives: Button (primary, secondary, ghost, destructive; heights 28/32/36), Input, Select, Combobox, Checkbox, Switch, Tabs, Popover, Dialog, Sheet (drawers), DropdownMenu, Tooltip, Command (⌘K), Badge, Progress, Skeleton, Sonner toasts. Tables on TanStack Table with TanStack Virtual for long lists.

### Data table spec

- Header 36 px, `slate-11` 12 px medium, sticky. Rows 40 px (32 px compact), `slate-6` divider, no zebra stripes.
- Cell padding 12 px horizontal. Text left, numbers right, empty value "—".
- First two columns frozen; a soft edge shadow appears once the table scrolls sideways.
- Deltas: ▲/▼ plus `grass-11` or `red-11`, judged by the metric's good direction.
- Status: 8 px dot + label. Active `grass-9`, Learning `blue-9`, Learning limited `amber-9`, Paused `slate-8`, In review `blue-9`, Rejected `red-9`, Not delivering `amber-9`.
- Virtualise above 200 rows; keep scroll position when data refreshes.

### Charts

- Recharts through the shadcn chart wrapper.
- One accent series; comparison period as a dashed `slate-8` line; gridlines `slate-4`; axis text 12 px `slate-11`.
- No 3D, no pie charts for metrics, area fills at most 10% opacity. Tooltip lists every series with formatted values.

### Numbers, dates, money

- `Intl.NumberFormat` in the ad account's currency; compact above 10,000 (12.4k); percentages to 1 decimal; ROAS to 2 decimals with "x".
- Dates and "today" in the ad account's time zone.
- Mixed-currency views convert to one reporting currency set in Settings, labelled in the column header.

### Motion

- 120–200 ms, ease-out `cubic-bezier(0.16, 1, 0.3, 1)`; drawers slide in 200 ms; no bounce.
- Optimistic updates on toggles; Undo toasts stay 6 s.
- Respect `prefers-reduced-motion`.

### Accessibility

- WCAG 2.2 AA contrast in both themes; 2 px `iris-8` focus ring on every interactive element.
- Everything reachable by keyboard; icon-only buttons carry `aria-label`; click targets at least 32 px.

### Responsive

- ≥ 1280 px: full layout. 1024–1279 px: sidebar collapses to the icon rail.
- Below 768 px: read-only — dashboard, ads list as cards, pause and activate. Launching stays desktop-only.

## Security, roles & spend guardrails

The Meta token never leaves the server, every write is logged, and no single click can raise spend past limits set by the owner.

### Token and secrets

- Encrypt each Meta token with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64) before it touches the database; store ciphertext, IV and the last 4 characters only.
- Decrypt only inside server code and the worker, never in client components or API responses.
- "Replace token" re-encrypts and re-verifies permissions; the old ciphertext is overwritten.
- All secrets live in environment variables; the database service-role key is used only server-side.

### Authentication

- Supabase Auth with email + password; TOTP two-factor required for owners and admins.
- Sessions expire after 7 days; sign-out revokes the refresh token.

### Permissions

| Action | Owner | Admin | Buyer | Viewer |
| --- | --- | --- | --- | --- |
| View dashboards, table, logs | ✓ | ✓ | ✓ | ✓ |
| Create launches (paused) | ✓ | ✓ | ✓ | — |
| Pause ads | ✓ | ✓ | ✓ | — |
| Activate ads, raise budgets | ✓ | ✓ | Within limits | — |
| Edit presets and templates | ✓ | ✓ | ✓ | — |
| Set guardrails per ad account | ✓ | ✓ | — | — |
| Manage Meta connections | ✓ | — | — | — |
| Manage team and roles | ✓ | ✓ | — | — |

Enforce every row twice: in Postgres row-level security and in the server action.

### Spend guardrails

1. Every object is created paused; going live is always a separate, confirmed action.
2. Activation and budget increases show the account's new total daily budget before confirm.
3. **Max daily budget per ad account:** block any change that pushes the account's total active daily budget above it.
4. **Approval threshold:** a buyer's change above it becomes an approval request for an owner or admin.
5. **Max change per edit:** buyers can move a budget at most 30% in one step (configurable).
6. **Kill switch:** an owner can stop every queue and pending launch with one button.

### Audit and safety

- Every write — from the UI, the worker or Claude — appends a `change_log` row with before, after and Meta's response.
- Validate all inputs with Zod on the server; reject unknown fields.
- Daily database backups with point-in-time recovery.
- Alert the owner by email on: token failure, account disabled, policy block (error 368), a launch that ends Failed.

## Repo structure & environment variables

One pnpm monorepo: the Next.js web app, a separate worker for long jobs, and shared packages for the database, the Meta client and validation.

```
fahd-ads-launcher/
├─ apps/
│  ├─ web/                    Next.js app: UI + server actions
│  │  ├─ app/
│  │  │  ├─ (auth)/login/
│  │  │  └─ (app)/
│  │  │     ├─ dashboard/
│  │  │     ├─ ads/
│  │  │     ├─ launch/[draftId]/
│  │  │     ├─ launches/[id]/
│  │  │     ├─ creatives/
│  │  │     ├─ copy/
│  │  │     ├─ presets/
│  │  │     └─ settings/
│  │  ├─ components/
│  │  │  ├─ ui/              shadcn components
│  │  │  ├─ table/           ads table, columns, bulk bar, drawer
│  │  │  ├─ charts/
│  │  │  └─ launch/          stepper, dropzone, pairing grid, review tree
│  │  └─ lib/                formatters, hooks, auth helpers
│  └─ worker/                 queue workers: sync, insights, upload, launch
├─ packages/
│  ├─ db/                     Drizzle schema, migrations, RLS policies, SQL views
│  ├─ meta/                   typed Graph API client, endpoints, error map, throttle
│  └─ shared/                 Zod schemas, types, naming-template engine
├─ CLAUDE.md
└─ .env.example
```

| Variable | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | web | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Public key; RLS protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | web server, worker | Never shipped to the browser |
| `DATABASE_URL` | web server, worker | Postgres connection for Drizzle |
| `REDIS_URL` | web server, worker | Job queues |
| `TOKEN_ENCRYPTION_KEY` | web server, worker | 32 random bytes, base64 |
| `META_API_VERSION` | web server, worker | `v26.0` |
| `META_APP_ID` · `META_APP_SECRET` | web server, worker | Sign every call with `appsecret_proof`; turn on "Require app secret" in the Meta app's advanced settings |
| `REPORTING_CURRENCY` | web server, worker | e.g. `USD`, for mixed-currency views |
| `RESEND_API_KEY` | worker | Alert emails |
| `SENTRY_DSN` | web, worker | Error monitoring |
| `ANTHROPIC_API_KEY` | web server | Phase 2 Claude panel only |

## Build plan

Four one-week milestones take the tool from an empty repo to a first live launch. Each week ends with checks that must pass before the next one starts.

&#91;embedded content: build plan · 4 weeks, 3 gates\]

Weeks map to the Claude Code sessions below: week 1 = sessions 1–4, week 2 = 5–6, week 3 = 7–9, week 4 = 10–12.

### Week 1 checks — Foundation

- [ ] App shell renders in light and dark, with sidebar, top bar and ⌘K.
- [ ] Migrations create every table; RLS stops a viewer from writing.
- [ ] Token is stored encrypted; Settings shows every required permission green.
- [ ] Ad accounts, pages, Instagram accounts and pixels list for every Business Manager.

### Week 2 checks — Read and control

- [ ] Campaigns, ad sets and ads reflect a change made in Ads Manager within 15 minutes.
- [ ] Yesterday's spend per account matches Ads Manager within 1%.
- [ ] Inline pause works with Undo; budget edits respect guardrails and log before and after.
- [ ] The table stays smooth at 2,000 rows.

### Week 3 checks — Launch

- [ ] A 500 MB video uploads, processes and shows Ready with no timeout.
- [ ] `name_9x16` and `name_4x5` pair into one creative automatically.
- [ ] "Test preset" passes for every preset.
- [ ] A launch of 20 ads across 4 ad sets is created paused, with correct names, placement mapping and UTMs.

### Week 4 checks — Harden and polish

- [ ] The launch log updates live; a forced error shows Meta's message and the fix; Retry re-runs only failed items.
- [ ] Guardrails block a change above the account maximum; a buyer's change above the threshold becomes an approval request.
- [ ] The kill switch stops every queue within 5 seconds.
- [ ] Every screen passes the design system rules in light and dark.
- [ ] **First live launch:** 1 campaign, 1 ad set, 2 ads created paused, checked in Ads Manager, then activated from the app.

## Claude Code playbook

Export this doc as Markdown to `docs/spec.md`, add the `CLAUDE.md` below at the repo root, and run one milestone per Claude Code session in the order listed.

### CLAUDE.md

```markdown
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
```

### Session order

Start each session with "Read docs/spec.md, section …" and one of these prompts.

1. Scaffold the monorepo from *Repo structure*. Set up Tailwind, shadcn/ui, Radix Colors tokens, Inter, light and dark themes. Build the app shell: sidebar, top bar, ⌘K palette. No data yet.
2. Write the Drizzle schema for every table in *Data model*, the RLS policies from *Permissions*, the metric SQL views, and seed data.
3. Build `packages/meta`: client, header parsing, error map, per-account throttle. Unit-test it with recorded Meta responses.
4. Build Settings → Meta connections: paste token, encrypt, verify permissions, sync ad accounts, pages, Instagram accounts and pixels.
5. Build the sync and insights workers, then the Ads table: level tabs, column presets, saved views, inline toggle and budget edit, bulk bar, detail drawer.
6. Build the Dashboard.
7. Build the Creatives library and the upload pipeline: images, videos, processing poll, per-account cache.
8. Build Presets, naming templates and ad set templates (clone from a live ad set), with "Test preset".
9. Build the Launch builder, all five steps, and the launch runner: tree walk, batching, idempotency, throttle.
10. Build the Launch log with live progress, inline errors and "Retry failed items".
11. Add guardrails, approval requests, the kill switch and alert emails.
12. Polish pass: walk every screen against *UI design system*; fix spacing, states, keyboard paths and contrast.

If a frontend-design skill is installed in Claude Code, tell it to use that skill on every UI task.

### Testing

- **Unit (Vitest):** naming engine, ratio pairing, metric maths, error mapping, throttle decisions.
- **Meta client:** recorded responses as fixtures; CI never calls Meta live.
- **End to end (Playwright):** the full launch builder against a mocked Meta API (MSW).
- **Live check before real use:** in a test ad account, create 1 campaign, 1 ad set and 2 ads, all paused. Open them in Ads Manager and confirm names, the 9:16 and 4:5 placement mapping, UTMs, pixel and Advantage+ creative settings match the launch.

## Backlog after v1

These wait until version 1 has run real launches for a few weeks.

- **Automated rules:** pause when CPA exceeds a target after a minimum spend; scale budgets in small steps; dry-run mode that only logs what it would do.
- **Claude panel:** the read-and-propose assistant described under Screens.
- **Flexible and carousel ads** through `creative_asset_groups_spec` and carousel creatives.
- **Breakdowns** in the table: placement, age, gender, country.
- **Creative reports** by angle and hook tag: which angles win per market.
- **Google Drive import:** paste a shared folder link instead of uploading.
- **True ROAS** from store orders matched by UTM, next to Meta-reported ROAS.
- **Client-owned accounts:** Facebook Login for Business plus Meta App Review.
- **TikTok launcher** on the same presets, creatives and launch flow.
- **Alerts to chat apps** in addition to email.
