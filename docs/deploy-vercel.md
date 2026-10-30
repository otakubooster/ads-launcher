# Going live on Vercel (monitoring and control)

This sets the app up as your own Ads Manager: every metric, pause and activate, budget
edits. Launch features stay switched off. Cost: $0 on the free plans (Vercel Pro is
$20/month if you want to stay strictly within Vercel's terms for business use).

Time: about 1 to 1.5 hours. Do part 2 (Meta) from home, on your usual internet connection.

Keep every value below in a password manager or a private note. Never paste them in a
chat, an email or a shared document. They only go into Vercel's settings page in part 5.

## What you'll collect

| # | Name in Vercel | Where it comes from |
|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` | Supabase |
| 2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| 4 | `DATABASE_URL` | Supabase |
| 5 | `META_APP_ID` | Meta |
| 6 | `META_APP_SECRET` | Meta |
| 7 | `TOKEN_ENCRYPTION_KEY` | A command on your computer |
| 8 | `CRON_SECRET` | A command on your computer |
| 9 | `OWNER_EMAIL` | Your email address |
| 10 | `REPORTING_CURRENCY` | Your choice, e.g. `USD` |

Also keep, but don't put in Vercel: the **Business ID** and the **system user token** from
Meta. You paste those into the app itself in part 7.

## 1. Supabase (database and login)

1. Go to supabase.com → **Start your project** → sign up (GitHub sign-in is easiest).
2. **New project**:
   - Name: `fahd-ads`.
   - Database password: click **Generate a password** and save it.
   - Region: **East US (North Virginia)**. Vercel runs in Washington DC by default, so
     this keeps the two close and the app fast.
   - Plan: **Free**. Click **Create new project** and wait about 2 minutes.
3. **Values 1 to 3:** gear icon (**Project Settings**) → **API Keys**.
   - If there's a **Legacy API keys** tab, use it: copy **anon public** (value 2) and
     **service_role** (value 3, the most sensitive one).
   - If you only see **Publishable key** and **Secret key**, those work too: publishable
     = value 2, secret = value 3.
   - Project URL (value 1), like `https://abcdefgh.supabase.co`: Project Settings →
     **Data API**, or the **Connect** button at the top.
4. **Value 4:** click **Connect** at the top → **Connection string** → **Transaction
   pooler**. Copy the line starting `postgresql://` (it ends in `:6543/postgres`).
   Replace `[YOUR-PASSWORD]` with the password from step 2, brackets included.
5. **Lock down sign-ups.** Left menu → **Authentication** → **Sign In / Providers** (or
   **Settings**). Turn **off** "Allow new users to sign up". You'll add yourself by hand
   in part 6.

## 2. Meta (from home)

You need admin access to your Business Manager (now called a "business portfolio").

**App ID and secret (values 5 and 6)**

1. developers.facebook.com → log in → **My Apps** → **Create App**.
2. Name `Fahd Ads`. Use case **Other** → type **Business** → link your business
   portfolio → **Create app**.
3. On the app dashboard, find **Marketing API** → **Set up**.
4. **App settings → Basic**: **App ID** is value 5. Next to **App secret** click
   **Show**, enter your Facebook password, copy it: value 6.
5. **App settings → Advanced**: turn on **Require app secret** → **Save changes**.

**Business ID**

business.facebook.com/settings → **Business info** → copy **Business portfolio ID**.

**System user token**

Still in business.facebook.com/settings:

1. **Users → System users → Add**. Name `fahd-ads`, role **Admin** → create.
2. With it selected → **Assign assets** → give **Full control** of:
   every ad account, every Facebook Page and Instagram account your ads use, every pixel
   (dataset).
3. **Accounts → Apps** → select **Fahd Ads** → **Assign people** / **Add people** → add the
   system user.
4. Back in **Users → System users** → select it → **Generate new token** →
   app **Fahd Ads** → expiry **Never** → tick: `ads_management`, `ads_read`,
   `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`,
   `pages_manage_metadata`, `instagram_basic` → **Generate token**.
5. Copy it right away; Meta shows it once.

Several business portfolios? Repeat the token steps in each one (add the same app to it first).

## 3. Two random keys (values 7 and 8)

**Mac:** open **Terminal** (⌘ + Space, type Terminal). Paste each line, press Enter, and
save what it prints.

```bash
openssl rand -base64 32
```

```bash
openssl rand -hex 32
```

The first is value 7 (`TOKEN_ENCRYPTION_KEY`), the second value 8 (`CRON_SECRET`).

**Windows:** open **PowerShell** from the Start menu and paste this; it prints both:

```powershell
$r=[Security.Cryptography.RandomNumberGenerator]::Create(); $a=New-Object byte[] 32; $b=New-Object byte[] 32; $r.GetBytes($a); $r.GetBytes($b); "TOKEN_ENCRYPTION_KEY: " + [Convert]::ToBase64String($a); "CRON_SECRET: " + ([BitConverter]::ToString($b) -replace '-','').ToLower()
```

Never change `TOKEN_ENCRYPTION_KEY` after setup: the saved Meta token is locked with it.

## 4. Get the code ready (one click)

On GitHub, open the pull request **"Deploy-ready: monitoring on Vercel"** in
`otakubooster/ads-launcher` → **Merge pull request** → keep **Create a merge commit** →
**Confirm merge**. That puts everything on `main`, which is what Vercel deploys. The
older pull requests then show as merged too.

## 5. Vercel

1. vercel.com → **Sign Up** → **Continue with GitHub** → plan **Hobby**.
2. **Add New… → Project** → find `ads-launcher` → **Import**. If it's not listed, click
   **Adjust GitHub App Permissions** and allow that repository.
3. **Root Directory** → **Edit** → choose `apps/web` → **Continue**. Framework should say
   **Next.js**. Leave build settings alone (the repo sets them).
4. Open **Environment Variables** and add values 1 to 10, one row each, with the exact
   names from the table. For `REPORTING_CURRENCY`, type a code like `USD`, `EUR`, `GBP`,
   `AED` or `SAR`.
5. Click **Deploy** and wait 2 to 4 minutes. The build also creates the database tables.
6. When it's done, copy your address, like `https://ads-launcher-abc.vercel.app`.
7. Back in Supabase → **Authentication → URL Configuration** → set **Site URL** to that
   address → **Save**.

If the build fails, open the failed deployment, copy the last lines of the log and send
them to Claude (they contain no secrets).

## 6. Your login

1. Supabase → **Authentication → Users → Add user → Create new user**.
2. Email: the same as `OWNER_EMAIL`. Pick a strong password. Tick **Auto Confirm User**.
   → **Create user**.
3. Open your Vercel address → sign in with that email and password.
4. You're asked to set up two-factor sign-in: scan the QR code with an authenticator app
   (Google Authenticator, Microsoft Authenticator or 1Password) and type the 6-digit code.
   Every sign-in after that asks for a code from the app.

## 7. Connect Meta

1. In the app: **Settings → Meta connections → Add connection**.
2. Paste the **Business ID** and the **system user token** → **Connect**.
3. All required permissions should show green, and your ad accounts, pages, Instagram
   accounts and pixels are listed.
4. Optional: **Settings → Ad accounts** → set a max daily budget per account as a safety net.
5. Open **Ads** and click the refresh icon at the top. Campaigns, ad sets and ads appear.

## 8. Automatic refresh every 15 minutes

Vercel's free plan refreshes once a day by itself. For every 15 minutes:

1. cron-job.org → **Sign up** (free) → confirm your email.
2. **Create cronjob**:
   - Title: `Ads sync`.
   - URL: `https://YOUR-ADDRESS.vercel.app/api/cron/sync?key=YOUR_CRON_SECRET`
     (your Vercel address, and value 8 after `key=`).
   - Execution schedule: **Every 15 minutes**.
   - **Create**.
3. Use **Test run**: it should show status **200** and a short text with `"accounts":`
   followed by how many ad accounts were refreshed.

This also stops Supabase's free plan from pausing the database for inactivity.

The app also refreshes whenever you open it and the data is more than 10 minutes old,
and the refresh icon at the top always works.

## After an update that adds metrics

Open this once in your browser (your address and `CRON_SECRET`) to re-pull the last 30
days, so new columns have history: 
`https://YOUR-ADDRESS.vercel.app/api/cron/sync?mode=backfill&days=30&key=YOUR_CRON_SECRET`

## Done

- Sign in from anywhere. Meta only ever sees Vercel's servers, never your location.
- Pause, activate and edit budgets from the **Ads** page; every change is logged under
  each item's **History**.
- **Settings → Kill switch** stops all background work at once if you ever need it.
