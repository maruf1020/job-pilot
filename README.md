<p align="center"><img src="public/logo.svg" alt="Job Pilot" width="112" height="112"></p>

# Job Pilot

A self-hosted job search assistant. It finds jobs from many sources and company job boards, ranks
them against your profile with AI, writes tailored application emails and sends them from your own
Gmail, fills application forms on company websites with a browser agent, and tracks the replies.

It is built for one person per install and works for any profession: a software engineer, a
designer, a data analyst, a marketer. Your profile (filled in once, in the app) decides which jobs
are searched, how they are ranked and what the applications say. Nothing about you lives in the
code or in `.env`.

> Use it responsibly. You stay in charge of what is sent: sending is off until you switch it on,
> every email is checked before it can be queued, and the browser agent hands CAPTCHAs, sign-ins
> and questions only you can answer back to you. See [Responsible use](#responsible-use).

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [First run](#first-run)
- [AI keys](#ai-keys)
- [Gmail, job sources and notifications](#gmail-job-sources-and-notifications)
- [Daily use](#daily-use)
- [The browser agent](#the-browser-agent)
- [Workers](#workers)
- [Telegram and ntfy](#telegram-and-ntfy)
- [Sharing, handing over and publishing a fork](#sharing-handing-over-and-publishing-a-fork)
- [Architecture](#architecture)
- [npm scripts](#npm-scripts)
- [Project layout](#project-layout)
- [Tests](#tests)
- [Deployment](#deployment)
- [Responsible use](#responsible-use)

## What it does

| Step | What happens |
|---|---|
| Find | Reads about 20 job sources (Arbeitnow, EURES, freehire.me, Jobnet, Jobindex, Bundesagentur, Hacker News "Who is hiring", Landing.jobs, The Muse, remote boards, Jooble, Adzuna, Reed, France Travail, JSearch, optional LinkedIn public pages and your own scrape targets) plus the public job boards of thousands of companies (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio, Teamtailor, Workday, BambooHR, Breezy, Pinpoint, JOIN). |
| Filter | Drops duplicates (same company, title and country), titles you excluded, postings in languages you do not speak and countries where you cannot work or be sponsored. |
| Understand | AI reads each posting: sponsorship, skills, seniority, contact email, the best way to apply. |
| Rank | Rules (title, skills, location, seniority, salary) plus an AI fit score against your profile. |
| Apply by email | Writes a tailored email (and a cover letter), checks it with a linter and an AI "hiring manager" judge, rewrites weak drafts, and sends from your Gmail inside a send window with a daily cap. |
| Apply on websites | A browser agent fills application forms in Chrome: rules for standard fields, your saved answers, then AI for the rest. It stops and asks you when only you can go on. |
| Follow through | Reads replies, classifies them (interview, rejection, "apply on our site", questions), drafts answers for you to review, sends follow-ups, and shows what needs you on one page. |

Shipped knowledge: a fresh install already knows about 28,000 companies with their job boards,
about 143,000 sponsor-register entries (UK, Ireland, Netherlands), the banned-phrase list for
emails, and what the form agents learned on about 900 application sites. See
[Knowledge pack](#the-knowledge-pack).

## Quick start

### Prerequisites

- **Node.js 22.12 or newer** (Node 24 works). The scripts use `process.loadEnvFile`, and Prisma 7
  needs 22.12+.
- **Docker** for the Postgres 16 database (or any Postgres 16 you point `DATABASE_URL` at).
- **Google Chrome** for the browser agent (optional; it falls back to Playwright's Chromium).

### Install

```bash
git clone <this repository> job-pilot && cd job-pilot
cp .env.example .env
```

Edit `.env`:

- `POSTGRES_PASSWORD`: any password, and put the same one into `DATABASE_URL` (replace `PASSWORD`).
- `AUTH_SECRET` and `APP_ENCRYPTION_KEY`: two different random strings of 32+ characters. Generate
  each with:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

  Keep `APP_ENCRYPTION_KEY` safe: it encrypts the keys and logins stored in the database, and a new
  value makes them unreadable.

That is all `.env` needs. AI keys, job-source keys and notifications are entered in the app.

```bash
docker compose up -d               # Postgres "job-pilot-postgres" on port 5546
npm install                        # also runs prisma generate
npx prisma migrate deploy          # creates the schema (same as npm run db:deploy)
npm run db:seed                    # default settings + the shipped knowledge pack (takes a minute)
npx playwright install chromium    # for scraping, PDF rendering and the tests
npm run dev                        # http://localhost:3012
```

`npm run dev` also starts the **search** and **apply** workers in the background
(`scripts/ensure-workers.mjs`), and checks them again every 5 minutes while the dev server runs.
They keep running when you stop the dev server. Set `NO_WORKERS=1` to skip them, for example when
you only work on the UI. See [Workers](#workers).

After a schema change (`npm run db:migrate`), restart the dev server and the workers: a running
Node process keeps the Prisma client it loaded at startup.

## First run

1. Open http://localhost:3012. With no account yet, every page leads to **/setup**: choose a name
   and a password (twice). The password is hashed with argon2.
2. You are signed out and land on **/login** ("Account created, please log in"). Log in with the
   name and password. Five wrong passwords lock the login for a while.
3. Until onboarding is finished, every page leads to **/onboarding**, a 10-step form. Each step is
   saved when you press Next, so you can leave and come back; everything can be changed later in
   **Settings > Profile**.

| # | Step | What it asks |
|---|---|---|
| 1 | AI keys | Optional. Add or paste keys (see [AI keys](#ai-keys)). With a key, your CV fills most of the next steps. |
| 2 | Your CV | Optional. A PDF; with an AI key it is parsed into the form. |
| 3 | Who you are | Name parts, preferred name, pronouns, email, phone with country code, links (LinkedIn, GitHub, portfolio, Behance, Dribbble, X, website). |
| 4 | Where you live and can work | Address, city, region, country, time zone, citizenships, sponsorship need and right-to-work countries, relocation, remote preference. |
| 5 | What you want | Profession (software, design, data, product, marketing, sales, operations, other), field, target titles, seniority, skills, title words to exclude, headline, years of experience, summary. |
| 6 | Where to look | Countries with priority, remote work, salary floor and currency, the languages you speak. |
| 7 | Experience and education | Check what was read from the CV or add it by hand; degree, GPA, quotable facts. |
| 8 | Standard form answers | Notice period, earliest start, salary expectation (and "only when asked"), how you heard, motivation, diversity questions (optional, "Prefer not to say" by default). |
| 9 | Email voice | Tone, topics never to mention, skills to lead with, signature. |
| 10 | Review and finish | Writes the profile, builds the search and ranking settings from it, seeds your saved form answers, then opens the dashboard. |

From then on: **Runs > Run now** starts a search (the workers also run them on a schedule). New
jobs appear under **Jobs**, drafts under **Applications**, replies under **Mail**, and everything
waiting for you under **Needs you**.

## AI keys

**Settings > AI** holds a pool of keys from any provider. Calls go to enabled keys in priority
order (lower number first); when a key hits its limit or fails, the next one takes over.

Supported providers (`src/lib/ai/providers.ts`):

| Kind | Providers |
|---|---|
| Native adapters | Google Gemini, Anthropic Claude |
| OpenAI-compatible | OpenAI (GPT / Codex), DeepSeek, Moonshot Kimi, Groq, OpenRouter, Mistral, xAI Grok, Together AI, Fireworks AI, Cerebras, Perplexity, Alibaba Qwen (DashScope), Zhipu GLM (Z.ai) |
| Local | Ollama, LM Studio |
| Custom | Any OpenAI-compatible endpoint (enter the base URL) |

Adding keys:

- **Add an AI key**: pick the provider (and a base URL for custom endpoints), paste the key, then
  **Test** and **Discover models**.
- **Import keys**: paste text or drop a `.env`, `.txt` or `.json` file. `NAME=value` lines, JSON
  objects and bare keys all work. The provider is detected in this order:
  1. the variable name (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY` / `KIMI_API_KEY`, ...),
  2. the key format (`AIza...` / `AQ.` Gemini, `sk-ant-` Anthropic, `sk-proj-` OpenAI, `sk-or-`
     OpenRouter, `gsk_` Groq, `xai-` xAI, `pplx-` Perplexity, `csk-` Cerebras, `fw_` Fireworks,
     `tgp_v1_` Together),
  3. a live probe of the candidate providers' model lists, for keys that several providers share
     (a plain `sk-...`).

  A preview shows the provider, how it was detected, the test result and suggested models;
  duplicates are skipped, and nothing is saved until you confirm. Service keys in the same text
  (Adzuna, Telegram, ...) are recognised too and saved under Keys & services.
- **Import from this server's .env**: reads the variables listed in `.env.example`. Keys in `.env`
  are never copied into the app on their own, so "Remove my data" cannot bring them back.

Per key you choose:

- **Primary model**: writing and careful checks (drafts, the judge, cover letters).
- **Lite model**: fast, cheap bulk work (enrichment, ranking, reply classification).
- **Plan**: *Free tier* keys follow the provider's free daily quota per model (Gemini: about 20
  requests a day on the Flash models, far more on the lite ones); *Paid* keys are capped by your
  daily call cap instead.
- **Priority**, enabled or not, and capability overrides (vision, web search, JSON mode).

Calls that send screenshots only go to keys with vision (others get a text-only fallback), web
search is used where the provider has it (Gemini grounding, Anthropic web search, OpenRouter,
Perplexity), and writing tasks never fall back to a lite model. Without any key the app still
searches and collects jobs; ranking, drafting and the form AI wait until you add one.

## Gmail, job sources and notifications

### Gmail (optional)

To send applications from your Gmail and read replies, create a Google OAuth client:

1. Google Cloud Console > APIs & Services > Credentials > **Create OAuth client** (Web application).
2. Authorized redirect URIs: `<APP_URL>/api/gmail/callback` (Gmail) and
   `<APP_URL>/api/auth/callback/google` ("Continue with Google" on the login page).
3. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, restart, then **Settings > Email >
   Connect Gmail**.
4. While the OAuth app is in *Testing*, Google ends the connection every 7 days. Publish it
   (Google Auth Platform > Audience > Publish app); a personal app needs no verification, you only
   click through the "unverified app" warning once. Then press **Reconnect Gmail**.

"Continue with Google" only signs in the owner whose account email matches; it never creates
users. Instead of Gmail you can send through any SMTP mailbox (Settings > Keys & services > SMTP;
replies are read over IMAP).

### Keys & services

**Settings > Keys & services** stores the credentials for everything that is not an AI model,
encrypted (`src/lib/keys/service-keys-defs.ts`). All are optional; a service without a key is
skipped. A value in `.env` with the same name is used as a fallback.

| Service | Fields | Used for |
|---|---|---|
| Adzuna | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | job search API (many countries) |
| Jooble | `JOOBLE_KEY` | job search API |
| RapidAPI (JSearch) | `RAPIDAPI_KEY` | JSearch listings (the legitimate route to LinkedIn, Indeed and Glassdoor postings) |
| Reed | `REED_KEY` | UK jobs |
| France Travail | `FRANCETRAVAIL_CLIENT_ID`, `FRANCETRAVAIL_CLIENT_SECRET` | French jobs ("Offres d'emploi v2") |
| Sapling | `SAPLING_KEY` | optional AI-text detector for drafts |
| Google Programmable Search | `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX` | finding hiring emails on the web (100 free queries a day) |
| Telegram bot | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | phone notifications and the control bot |
| ntfy | `NTFY_TOPIC`, optional `NTFY_SERVER`, `NTFY_TOKEN` | phone notifications |
| SMTP mailbox | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | sending from a non-Gmail mailbox |

The free sources (Arbeitnow, EURES, freehire.me, Jobnet, Jobindex, Bundesagentur, Hacker News,
Landing.jobs, The Muse, Jobicy, Himalayas, Remote OK, Working Nomads, Remotive, company boards)
need no key. `npx tsx scripts/sources-check.ts [source ...]` sends one small request to each
configured source and prints what came back.

## Daily use

- **Today** (dashboard): what needs you, applications sent today / this week / this month, and a
  chart. **Stats** has the long view, with an **AI** section: calls per task and day, and why forms
  stopped.
- **Jobs**: everything found, with score, reasons and status. **Companies**: employers, their job
  boards, sponsor-register matches, and **Find boards** to discover more company boards.
- **Applications**: drafts, the review queue and a Kanban board. **Auto-apply** prepares and sends
  your best matches in a batch (2 to 1000) with a minimum score; starting it is your permission
  for that batch only.
- **Mail**: a three-pane mailbox over your applications (Needs answer, Important, Replied, Sent,
  Needs review, Drafts, Waiting, Held). **Draft with AI** writes a reply from your profile and
  saved answers; a fact it does not know becomes a `[placeholder]` you fill in before sending.
- **Opportunities**: interview requests, processes in progress and "what you need to do".
- **Needs you**: forms waiting for a CAPTCHA, a sign-in, an emailed code or an answer only you know.
- **Hosts**: what the agent learned per website (direct form, sign-in wall, CAPTCHA, no form).

### Nothing is sent without your say-so

- **Settings > Email > Allow sending** is off on a new install. While it is off the worker never
  sends queued applications or follow-ups. **Auto-send** is a second switch, also off.
- **Send now** on one application is the only thing that sends while the switch is off: that click
  is your permission for that one email.
- Sending honours a send window in the job's local time, a daily cap (10 by default), a random gap
  between emails, one application per company per 15 days (configurable), a bounce brake and a
  block list. Reserved and demo domains (`.example`, `.test`, `.invalid`) and template addresses
  are always refused.
- A personal Gmail account allows about 500 emails a day; fast bursts of cold emails can get
  sending blocked for a day. Slower is safer.

### How the emails are written

Every email is written for one posting from your profile and the voice you chose in onboarding:
where you saw the posting, what in it caught your interest, two or three of its requirements
matched with real things from your experience, why this company, and a low-pressure ask. Topics in
your "never mention" list never appear. A deterministic linter (banned phrases, punctuation,
length) and an AI judge send weak drafts back for a rewrite, up to 3 rounds. The AI may only use
facts from your profile and saved answers; it never invents a salary, a notice period or a permit.

### Contact discovery

When a posting has no email address, the company's address is looked for once and reused for all
its jobs: addresses already known, the company's website (careers, contact and imprint pages,
including obfuscated addresses), AI web search, Google Programmable Search when configured, then
role-mailbox guesses (`careers@`, `jobs@`, ...) on domains that accept mail. Candidates are checked
against the company's mail server with an SMTP `RCPT TO` probe (nothing is sent); many home ISPs
block port 25, in which case the check is skipped. Guessed addresses are never used by auto-send
unless you allow it (Settings > Email). CLI: `npx tsx scripts/find-contact.ts "<company>"`.

## The browser agent

Many good jobs have no email address, only a form. The browser agent fills those forms in a real
Chrome window:

- **The apply browser**: Chrome with its own saved profile (`storage/chrome-profile`) and a local
  DevTools port (Settings > Browser, default 9343). `npm run browser [-- <url>]` opens it, for
  example to log in to a site once. Or turn on **Use my Chrome** to let the agent open its tabs in
  the Chrome you already use (tick "Allow remote debugging" at `chrome://inspect/#remote-debugging`).
- **Answers** come from, in order: rules for the standard fields (name, contact, links, location,
  work authorisation per country, diversity questions, consents) read from your profile; **your
  saved answers** (the answer bank, Settings > Browser); then one AI call per page for the rest,
  limited to facts from your profile and answers. A required question it cannot answer truthfully
  stops the run and waits in **Needs you**; answer it once and it is reused on every form.
- **When rules get stuck**, an AI driver takes over: it looks at a screenshot and the page's
  accessibility snapshot, acts a few steps at a time, and follows what worked before on the same
  kind of site (**site lessons**, shared knowledge). A "second look" tries small fixes after a stop.
- **One job**: **Apply in browser** on a job fills the form and stops before Submit; you review and
  press Submit. **Open with AI** on a Needs-you row opens the form in your Chrome with a chat panel:
  the AI fills it, waits for you where needed, then submits.
- **Many jobs**: Applications > **Browser apply** runs a batch, best score first, one company at a
  time, with a daily cap and a pause between submissions.
- **Try it safely**: `npm run portal:dry -- <jobId | url> [--headed] [--ai]` opens a real form,
  plans and fills the answers, saves a screenshot and never submits or writes to the database.

### Hard rules

- It **never solves or bypasses a CAPTCHA**. It fills the rest and hands the tab to you.
- It **never signs up, logs in or types a password** on a site's sign-in wall. You sign in once in
  the apply browser (the login is saved) or in the tab it opened, and it carries on.
- An **emailed code** or verification link it cannot read stops the run and waits for you.
- Indeed and Xing are never automated (their terms forbid it). **LinkedIn Easy Apply** is off by
  default; LinkedIn's terms forbid bots, so switching it on is your decision and your risk.
- Required uploads are checked before Submit, and a job is never applied to twice.

Two adapter-specific exceptions exist in the current code and are worth knowing before you enable
those sites (Settings > Browser > sites):

- **Workday**: the agent signs in to each company's Workday site with a per-site candidate
  account, and creates that account when none exists (your email plus a generated password,
  stored encrypted; Settings > Browser > Site accounts shows it). Untick Workday in the site list
  if you do not want that.
- **Emailed security codes**: when Gmail is connected, the agent reads a site's one-time code
  (for example the Greenhouse security code) or verification link from your inbox and enters it.
  Without Gmail it stops and asks you.

## Workers

The web app only queues work. Two background workers (pg-boss queues in Postgres) do it:

| Role | Runs |
|---|---|
| `search` | search runs and light board runs, enrichment, ranking, drafting, sending, reply polling, the inbox scan, auto-apply email batches, contact and board discovery, scraping, the daily digest, the Telegram bot |
| `apply` | the browser agent: batches, single-job attempts, portal status checks, hand-overs, browser control |
| `all` | both in one process (the default for `npm run worker` and Docker) |

- `npm run worker:search` and `npm run worker:apply` (or `worker:forever` for `all`) run
  `scripts/workers.mjs`, a supervisor that restarts the worker when it exits (5 s backoff doubling
  to 60 s) and writes `storage/logs/worker-<role>-<YYYYMMDD>.log`. After 3 restarts in 10 minutes
  it sends one phone notice.
- Only one supervisor per side runs at a time (`storage/locks/worker-<side>.pid`); a second one
  exits with code 3. Run either `all`, or `search` + `apply`, never `all` next to a role.
- `npm run workers:ensure` starts whichever role is not running (`npm run dev` does this for you).
  On Windows it goes through `scripts/ops/ensure-workers.ps1`, so the workers survive closing the
  terminal; it logs to `storage/logs/ensure-workers.log`.
- Windows, without the dev server: `scripts/ops/install-worker-task.ps1` registers a "Job Pilot
  workers" scheduled task that runs the same check at log on and every 5 minutes:

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\ops\install-worker-task.ps1
  # remove: Unregister-ScheduledTask -TaskName 'Job Pilot workers' -Confirm:$false
  ```

- `npm run worker:dev` runs one worker in watch mode in your terminal (stop the background ones
  first). `WORKER_ACTIVE_HOURS` / `WORKER_ACTIVE_DAYS` make a worker disconnect outside those hours,
  which keeps a serverless database (Neon) inside its free compute budget.

## Telegram and ntfy

Add **ntfy** (a long random topic name, then subscribe in the ntfy app) or a **Telegram bot**
(create one with @BotFather, send it a message, enter the token and your chat id) under Settings >
Keys & services, choose the notification types in **Settings > General**, and press **Send a
test**. Interview requests and human replies push every time; forms waiting, problems and batch
results at most once every 15 minutes.

The Telegram bot also takes commands (it runs in the `search` worker; send `/help`): `/status`,
`/todo`, `/replies`, `/mail`, `/stats`, `/loops`, `/job <text>`, `/search`, `/apply`,
`/applymore`, `/pause`, `/resume`, `/sendnow`, `/sendready`, `/ask`, `/ai`, `/metrics`, `/notify`,
`/whoami`.

- Only the chat in `TELEGRAM_CHAT_ID` is answered; messages older than 5 minutes are ignored.
- Commands that send anything (`/sendnow`, `/sendready`) show a preview with **Confirm / Cancel**,
  and still go through the send window, daily cap, cooldown and block list.
- `/ai` and plain text answer questions about your data with read-only SQL: one `SELECT` at a time,
  only whitelisted tables (never users, keys, tokens or the profile), in a `READ ONLY` transaction
  with a 5 s timeout. For a second guard, create a SELECT-only Postgres role and set
  `AI_QUERY_DATABASE_URL`.

## Sharing, handing over and publishing a fork

### Download and remove your data

**Settings > Account > Danger zone**:

- **Download my data**: your profile, saved answers, applications and settings as one JSON file.
- **Remove my data**: type your account name and password. It stops running batches, cancels queued
  jobs, then deletes everything about you and keeps the shared knowledge, so the install can be
  handed to someone else. The app signs out and starts again at `/setup`.

| Deleted | Kept (shared knowledge) |
|---|---|
| The account, profile, CVs and photo | Companies (blacklist and notes cleared) |
| Applications with their emails, drafts, form attempts and events; apply and browser batches | Jobs (status back to new, scores removed) and where they were found |
| Job scores, inbox messages, notifications | Job boards, scrape targets and sponsor registers |
| Saved form answers, site logins, the Gmail connection | Banned phrases, site profiles (logged out) and site lessons |
| AI keys, service keys and their usage | Bounced addresses (manual block-list entries are deleted) |
| Search runs, source cursors, settings (back to defaults) | Board-discovery history |
| Personal files under `storage/`: CV copies, cover letters, screenshots, browser profiles, logs, Telegram caches | |

The same from the command line (for headless installs; stop the workers first):

```bash
npm run data:remove-user                               # explains, changes nothing
npm run data:remove-user -- --yes                      # database + personal files
npm run data:remove-user -- --yes --export my-data.json  # save a copy first
npm run data:remove-user -- --yes --db-only            # keep the files
```

### The knowledge pack

`database/knowledge/*.ndjson.gz` (with `manifest.json`) is the shared knowledge a fresh clone starts
with: companies and their job boards, sponsor registers, scrape targets, banned phrases, site
profiles and site lessons. `npm run db:seed` imports it.

```bash
npm run knowledge:export              # regenerate the pack from your database
npm run knowledge:export -- --jobs    # also the jobs found so far (large)
npm run knowledge:import              # add whatever is missing to this database
npm run knowledge:import -- --dir <folder>
```

- Only role mailboxes (`jobs@`, `careers@`, `hr@`, ...) go into the pack; addresses of named people
  stay in your own database. Site lessons are stored with your personal values replaced by
  placeholders.
- The jobs export (`database/knowledge/jobs*.ndjson.gz`) is gitignored: share it as a file, not
  in the repository.
- Import never overwrites: it only adds rows that are missing.

### Before you publish a fork

```bash
npm run check:privacy
```

It scans every file git would publish (and the compressed knowledge pack) for personal mailbox
addresses and long phone numbers, allowing only the fictional test personas. For your own details,
create a local `.privacy-denylist` file (gitignored, never published): one word, name, number or
`/regex/i` per line, for example your name, phone and street. Every hit is an error (exit code 1).

## Architecture

```
            Next.js app (port 3012)                     Postgres 16
  pages + API routes  --- queue jobs (pg-boss) --->  +-------------------------+
         |                                           | jobs, companies, apps,  |
         |  reads/writes                             | profile, keys (encr.),  |
         v                                           | settings, knowledge,    |
   src/lib/* (shared)  <------ same code ------->    | pg-boss queues          |
                                                     +-------------------------+
   search worker: sources -> dedupe -> prefilter -> enrich -> rank -> draft/judge -> send
                  inbox scan, reply classification, follow-ups, digest, Telegram
   apply worker:  portal batches -> browser agent (rules, answer bank, AI driver,
                  site lessons) -> submitted | needs you
```

- **CandidateContext** (`src/lib/candidate/context.ts`) is the single source of truth about the
  person: every prompt, form rule, ranking rule and email reads it, built from the profile.
- **AI router** (`src/lib/ai/`): `generateJson` / `generateText` pick (key, model) pairs by
  priority, task tier (primary / lite) and needed capabilities, then validate JSON with zod and
  retry.
- **Secrets**: AI keys, service keys, Gmail tokens and site logins are encrypted with AES-256-GCM
  (`APP_ENCRYPTION_KEY`).

More detail, including the data-ownership table: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Stack: Next.js 16 (App Router), React 19, Tailwind v4 + shadcn/ui, TanStack Query/Table, Prisma 7 +
PostgreSQL 16, pg-boss, Auth.js, patchright/Playwright, Vitest + Playwright tests.

## npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | web app in watch mode on port 3012; starts the workers first (`NO_WORKERS=1` skips) |
| `npm run build` / `npm run start` | production build / web server on port 3012 |
| `npm run worker` / `npm run worker:dev` | one worker (role from `WORKER_ROLE`, default `all`) / the same in watch mode |
| `npm run worker:search` / `worker:apply` / `worker:forever` | supervised worker by role (`forever` = `all`), restarted on exit |
| `npm run workers:ensure` | start the search and apply workers that are not running |
| `npm run browser [-- <url>]` | open the apply browser with its saved profile |
| `npm run portal:dry -- <jobId\|url> [--headed] [--ai]` | dry run of the browser agent on a real form; never submits |
| `npm run record:applied -- <file.json>` | record an application you made by hand (form link, answers, confirmation) |
| `npm test` / `npm run test:watch` | unit tests (Vitest) |
| `npm run test:e2e:prepare` / `test:e2e` / `test:e2e:ui` / `test:e2e:reset` | end-to-end tests (see [Tests](#tests)) |
| `npm run typecheck` / `npm run lint` / `npm run format` | TypeScript / ESLint / Prettier |
| `npm run db:migrate` / `db:deploy` / `db:generate` / `db:studio` / `db:reset` | Prisma: dev migration / apply migrations / client / Studio / reset |
| `npm run db:seed` | default settings, starter companies and the knowledge pack (no user) |
| `npm run seed:demo` | a deterministic demo dataset (used by the e2e tests) |
| `npm run knowledge:export [-- --jobs]` / `knowledge:import` | the shared knowledge pack |
| `npm run data:remove-user -- --yes` | remove the owner's data, keep the shared knowledge |
| `npm run check:privacy` | scan the publishable files for personal data |
| `npm run db:dump` / `prod:restore` | dump the local database / restore it into `DIRECT_DATABASE_URL` |
| `npm run prod:migrate` / `prod:seed` / `prod:studio` / `prod:worker` | the same commands against `.env.production.local` |

Useful one-off scripts (`npx tsx scripts/<name>.ts`): `smoke.ts [ai|sources|draft|all]` (live
checks), `sources-check.ts`, `models.ts` (models each stored key can use), `gemini-keys-check.ts`
(tests every stored AI key, any provider), `find-contact.ts`, `boards-backfill.ts`,
`employer-links.ts`, `import-sponsors.ts`, `ats-boards.ts`, `rescore-rules.ts`, `run-once.ts`.

## Project layout

```
src/
  app/                 Next.js routes: (app) pages, (auth) login, (onboarding), setup, api/
  components/          UI (shadcn/ui based), onboarding wizard, settings forms
  lib/
    candidate/         CandidateContext: the person, read from the profile
    ai/                providers, adapters (gemini, anthropic, openai-compat), router, prompts
    keys/              AI key pool storage, service keys, the importer and detection
    sources/           job sources and company board readers
    pipeline/          search run: discover, dedupe, prefilter, enrich, rank, contacts, draft, batches
    ranking/           rule score
    apply/             browser agent: plan, standard answers, answer bank, driver, fixer, lessons, adapters
    browser/           Chrome launch and attach (patchright), clean Chrome
    email/, mail/      sending, Gmail/SMTP, replies, follow-ups, mailbox folders
    inbox/             inbox sync
    telegram/          bot, commands, read-only AI questions
    account/           download and remove the owner's data
    settings/          settings schema, defaults, derive-from-profile
  worker/              start.ts (entry), main.ts, roles, scheduler
prisma/                schema, one baseline migration, seed.ts
database/knowledge/    the shipped knowledge pack
scripts/               CLI tools, workers.mjs (supervisor), ensure-workers.mjs, knowledge, privacy check
scripts/ops/           operator tools: Windows worker task, drain/pause, queue helpers, brief templates
e2e/                   Playwright end-to-end specs
storage/               runtime files (gitignored): logs, locks, CV copies, screenshots, Chrome profiles
```

## Tests

```bash
npm test                    # unit tests (Vitest)
npm run typecheck
npm run test:e2e:prepare    # creates <db>_e2e, migrates, seeds, builds into .next-e2e
npm run test:e2e            # Playwright on port 3100 against the e2e database
```

- The e2e setup never touches your real database or the `.next` of a running dev server: every
  command goes through `scripts/e2e-env.mjs`, which refuses any database whose name does not end
  in `_e2e`. `npm run test:e2e:reset` recreates that database first.
- Tests and fixtures use fictional people only: **Alex Rivera** (Lisbon, Portugal; the e2e owner
  created by `scripts/seed-e2e.ts`, log in as "Alex Rivera") and **Sam Okafor** (Lagos, Nigeria,
  needs sponsorship). Never put a real person's data into tests.
- Tests never send email: they use dry-run modes, fakes and reserved domains that the sender
  refuses.

## Deployment

- **One box with Docker**: `docker-compose.prod.yml` runs Postgres, a one-shot migrate + seed, the
  web app and a worker from the same image (`Dockerfile`, based on the Playwright image so the
  worker has Chromium):

  ```bash
  cp .env.example .env    # fill it in; DATABASE_URL is set to the postgres service by the compose file
  docker compose -f docker-compose.prod.yml up -d --build
  ```

  Put Caddy or Traefik in front for HTTPS and set `APP_URL` / `AUTH_URL` to the public URL. The
  container worker runs headless; the browser agent works best on a machine with a screen where
  you can step in.
- **Hosted web + separate worker**: the web app can run on a serverless host (an `amplify.yml` for
  AWS Amplify is included) with a hosted Postgres such as Neon. Serverless hosts cannot run the
  worker (no long processes, no browser, no port 25), so run it on any always-on box:

  ```bash
  cp .env.production.example .env.worker   # DATABASE_URL = the direct (non-pooled) URL
  docker compose -f docker-compose.worker.yml up -d --build
  ```

  `.env.production.example` documents the production variables; the `prod:*` scripts read
  `.env.production.local`. Keep `APP_ENCRYPTION_KEY` the same everywhere that shares a database.
- Only one worker per role may run against a database.

## Responsible use

- **Respect each site's terms.** Some job boards forbid automated access (LinkedIn, Indeed, Xing).
  The LinkedIn source and LinkedIn Easy Apply are off by default; scraping targets are yours to
  choose, so check a site's terms and robots.txt first.
- **Keep it slow.** Sources rest between runs, the browser agent pauses between submissions and the
  sender spaces emails out. Do not raise the caps to spray applications.
- **Be truthful.** The app only uses facts from your profile and your answers. Keep them accurate;
  a missing fact becomes a question for you, never a guess.
- **Review what is sent.** Start with sending off, read the drafts, and switch on auto-send only
  when you trust them. Every application goes out under your name.
- **Your data stays with you.** Everything is in your database and `storage/` folder. Keys and
  logins are encrypted, and "Remove my data" wipes it.

## License

MIT, see [LICENSE](LICENSE).
