# Architecture

How Job Pilot is put together: the processes, the two pipelines, where the person's data lives
and how AI calls are routed. For setup and day-to-day use see the [README](../README.md).

## Processes

| Process | Entry | What it does |
|---|---|---|
| Web app | `next dev` / `next start` on port 3012 | Pages, API routes (`src/app/api`), auth, settings, onboarding. Never does long work itself: it writes rows and enqueues pg-boss jobs. |
| Search worker | `src/worker/start.ts` with `WORKER_ROLE=search` | Search runs, enrichment, ranking, contacts, drafting, sending, reply polling, inbox scan, email batches, board discovery, scraping, digest, Telegram bot. |
| Apply worker | `src/worker/start.ts` with `WORKER_ROLE=apply` | The browser agent: browser batches, single-job attempts, portal status checks, hand-overs, browser control. |
| Supervisor | `scripts/workers.mjs <role>` | Restarts a worker when it exits, writes `storage/logs/worker-<role>-<day>.log`, holds `storage/locks/worker-<side>.pid` so only one supervisor per side runs. |
| Postgres 16 | `docker-compose.yml` (`job-pilot-postgres`, port 5546) | All state, including the pg-boss queues (schema `pgboss`). |

`src/worker/start.ts` loads `.env` and imports `src/worker/main.ts`, which registers the queue
handlers for its role (`src/worker/roles.ts`) and the cron schedules (`src/worker/scheduler.ts`).
Queue names are in `src/lib/queue.ts`. Each role only fails orphaned jobs of its own queues on
start-up, so a restart of one side never disturbs the other.

The web app and the workers share all of `src/lib`; there is no separate service layer.

## The person: CandidateContext

`src/lib/candidate/context.ts` defines `CandidateContext`, one typed object built from the
`CandidateProfile` row (filled by onboarding and Settings > Profile). It is the **only** place the
app learns anything about the person. Prompts, form rules, ranking rules, the browser agents, the
email writer and the Telegram texts all read it.

- `loadCandidateContext()` (`src/lib/candidate/load.ts`) reads the profile with a 30 s cache;
  `invalidateCandidateContext()` drops it after a profile change or a data removal.
- Pure helpers answer the questions forms and prompts need: `hasRightToWork(ctx, country)` and
  `needsSponsorshipFor(ctx, country)` (citizenships, explicit right-to-work countries, EU/EEA/CH
  free movement), `workRightsSentence`, `identityFacts`, `pronounWords`, `internationalPhone`,
  `splitName`, `diversityAnswer` (defaults to "Prefer not to say"), and `PROFESSIONS`.
- `scrubPersonal(text, ctx)` replaces the person's values with `{placeholders}` and
  `fillPlaceholders(text, ctx)` puts the current person's values back. Shared knowledge (site
  lessons) is always stored scrubbed.
- A missing answer is normal (a fresh install, a skipped question). Code degrades to neutral text
  or to "needs the person", never to a hard-coded value.

Onboarding's last step (`POST /api/onboarding/finish`) also derives Settings from the profile
(`src/lib/settings/derive.ts`: search queries from target titles, ranking keywords from skills,
countries and tiers, title rules, time zone) and seeds the answer bank with the standard details.

## Search pipeline

`executeSearchRun()` in `src/lib/pipeline/run.ts` runs these steps in order. Every step can be
stopped ("Stop run"); what was found so far is kept.

```
discover -> deep-fetch -> boards -> prefilter -> enrich -> rank -> employer-links -> contacts -> draft
```

| Step | Code | What happens |
|---|---|---|
| discover | `pipeline/discover.ts`, `sources/*` | Reads the enabled sources (several at once). A rotation (`pipeline/rotation.ts`) spreads queries x countries across runs; sources that keep failing rest (`pipeline/source-rest.ts`). Each posting goes through `pipeline/ingest.ts`. |
| dedupe | `pipeline/dedupe.ts` | Same company + title + country = one `Job`; every place it was seen becomes a `JobSourceLink`. |
| deep-fetch | `pipeline/deep-fetch.ts` | Fetches the full text of postings that arrived as short snippets. |
| boards | `sponsors/*`, `sources/ats.ts` | Registers company ATS boards seen in job links and probes known employers for a board. Light runs between the full ones read only the boards and the visa-flagged feeds. |
| prefilter | `pipeline/prefilter.ts` | Cheap rules without AI: excluded title words, language, region and work-rights rules from the CandidateContext. Filtered jobs keep a `filterReason`. |
| enrich | `pipeline/enrich.ts` | Lite-model AI reads each posting: sponsorship, skills, seniority, contact email, apply channel. |
| rank | `pipeline/rank.ts`, `ranking/rules.ts` | Rule score (title, skills, seniority, location, salary; stack rules only for the software profession) blended with an AI fit score (`llmWeight`, 0.4 by default) into `finalScore`. |
| employer-links | `pipeline/employer-links.ts` | Maps board-only postings (Adzuna, Jooble, ...) to the employer's own form. |
| contacts | `pipeline/contacts.ts` | Finds an application address per company, cheapest strategy first, verified by an SMTP probe where port 25 is open. |
| draft | `pipeline/draft.ts`, `pipeline/humanize/*` | For jobs above the draft threshold: write, lint (banned phrases, punctuation), judge with the primary model, rewrite up to 3 rounds. |

After drafting, `pipeline/decide.ts` decides queue / review / not eligible: auto-send and the
"Allow sending" switch, the eligibility gate (`pipeline/quality-gate.ts`: permits per country,
using `needsSponsorshipFor`), the company cooldown, the daily cap. `pipeline/channel.ts` sends jobs
on systems that answer cold email with "apply on our site" to the browser agent instead.

Sending (`email/send.ts`, queue `mail.dispatch`) runs inside the job's local send window, spaced by
a random gap, through Gmail (`email/gmail.ts`) or SMTP (`email/smtp.ts`). Recipients on reserved
domains, template addresses and suppressed (bounced or blocked) addresses are refused.

Auto-apply batches (`pipeline/apply-batch.ts`, queue `apply.batch`) run the same draft and decide
steps continuously for the best N jobs, one per company and location.

## Inbox and replies

- `email/track.ts` (`mail.poll`) polls the threads of sent emails, classifies each reply
  (`REPLY_CLASSIFICATIONS` in `src/lib/domain.ts`: interview request, positive, needs info,
  location issue, rejection, apply via portal, wrong recipient, auto-reply, bounce, other) with the
  lite model and moves the application; it also sends due follow-ups.
- `apply/inbox-scan.ts` (`inbox.scan`) reads new mail from application systems and from companies
  you applied to through websites, matches it to the application (domain, company, title, date) and
  updates the status. Every message is read once (`InboxMessage`).
- `email/reply.ts` drafts an answer for you; nothing there sends on its own. Missing facts become
  `[placeholders]`.
- `mail/folders.ts` turns applications into the Mail folders; `applications/manual-todo.ts` builds
  the "what you need to do" list.

## Apply pipeline (browser agent)

```
portal batch / single job -> attempt -> page loop:
    plan (rules -> answer bank -> one AI call) -> fill -> next/submit
    stuck? -> fixer (second look) -> AI driver (screenshots + site lessons)
    -> submitted | review | needs you (CAPTCHA, sign-in, code, question)
```

| Part | Code | Role |
|---|---|---|
| Batches | `apply/portal-batch.ts` | Best score first, one company at a time, daily cap, gap between submissions, sites from Settings > Browser. |
| Attempt | `apply/attempt.ts` | One form in one tab: navigation, the page loop, CAPTCHA and sign-in detection, submit confirmation (page text, URL, network signals in `apply/submit-signal.ts`). |
| Adapters | `apply/adapters/*` | Per application system: direct form link, time budget, CAPTCHA kind, which browser it must run in. |
| Plan | `apply/plan.ts`, `apply/standard.ts` | Rules for the standard fields from the CandidateContext, then the answer bank, then one AI call for the rest. A required question nobody can answer truthfully becomes an open question. |
| Answer bank | `apply/answer-bank.ts` | Your answers, reused on every form. `std:*` rows are the standard details; `answer = null` means "waiting for you". |
| AI driver | `apply/driver.ts` | When rules get stuck: screenshot + accessibility snapshot, a few actions, repeat. |
| Fixer | `apply/fixer.ts` | A short second look right after a stop. |
| Site lessons | `apply/lessons.ts`, table `SiteLesson` | What worked per kind of site, fix hints and stop diagnoses. Shared knowledge: written through `scrubPersonal`, read through `fillPlaceholders`. |
| Hand-over | `apply/handover.ts`, `apply/ask.ts`, `apply/panel-*.ts` | The form opens in your Chrome with a chat panel; the app learns the answers you give and records the application when the site confirms. |
| Browser | `browser/chrome.ts` | Launches or attaches to Chrome through patchright (`BROWSER_LIB=playwright` switches back). |

Rules that hold everywhere: CAPTCHAs are never solved, the AI driver and fixer refuse sign-up,
log-in and account actions (`NEVER_RE` / `NOT_FOR_FIXER`), and the agent never types a password on
a sign-in wall. Two adapters go further and are documented in the README: Workday (per-site
account with a generated, encrypted password; `apply/workday.ts`) and emailed one-time codes read
from Gmail (`apply/email-codes.ts`).

## AI layer

```
caller -> generateJson / generateText (ai/generate.ts)
       -> router (ai/router.ts): candidates = keys x models, ordered
       -> key pool (ai/key-pool.ts): quota per key and model, cooldowns
       -> adapter (ai/adapters/gemini | anthropic | openai-compat)
       -> zod validation, repair, retry
```

- **Providers** (`ai/providers.ts`): id, adapter, base URL, key formats, env names, default
  primary/lite models, capabilities (JSON mode, vision, web search), free daily quotas and the
  quota time zone.
- **Router**: a call asks for a tier (`primary` for writing and judging, `lite` for bulk work) and
  may need images or web search. Keys with every needed capability come first, in priority order;
  a key without vision gets a text-only call, a key without search gets the call without search.
  Primary tasks never fall back to a lite model.
- **Key pool**: per key and model it counts today's calls (from `AiUsage`) against the free quota,
  or the daily cap for paid keys, and remembers exhausted or cooling-down combinations so the
  router moves on instead of retrying.
- **Prompts** (`ai/prompts/index.ts`) take a `ProfileForPrompt` that carries the
  `CandidateContext`; nothing in a prompt names a person.
- Every call is logged in `AiUsage` (provider, model, task, tokens) for Stats and Settings > AI.

## Keys and secrets

| What | Where | Protection |
|---|---|---|
| Install secrets | `.env` (`AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `DATABASE_URL`, optional Google OAuth client) | Never in the database or git. |
| AI keys | `AiKey` (provider, base URL, models, priority, plan, caps, status) | AES-256-GCM with `APP_ENCRYPTION_KEY` (`src/lib/crypto.ts`), `keyHash` (sha256) prevents duplicates, UI shows the last 4 characters only. |
| Service keys | `ServiceKey` (Adzuna, Jooble, RapidAPI, Reed, France Travail, Sapling, Google CSE, Telegram, ntfy, SMTP) | Encrypted the same way; `.env` values with the same names are a fallback (`keys/service-keys.ts`). |
| Gmail | `OAuthToken` | Refresh token encrypted. |
| Site accounts | `PortalAccount` | Passwords encrypted. |
| Login | `User.passwordHash` | argon2; 5 failed attempts lock the login for 30 minutes; `sessionVersion` in the JWT is checked on every request, so a password change or a data removal ends every old session. |

The importer (`keys/detect.ts` pure parsing and detection, `keys/import.ts` probing and saving)
detects a key's provider by variable name, then key format, then a live probe of the candidate
providers' model lists. Previews never include the full secret. Keys in `.env` are imported only
when the owner presses "Import from this server's .env".

## Data ownership

One install has one owner. "Remove my data" (`src/lib/account/remove.ts`, also
`npm run data:remove-user -- --yes`) deletes the personal side and keeps the shared side, so the
database can be handed to someone else.

| Personal (deleted) | Shared knowledge (kept) |
|---|---|
| `User` | `Company` (blacklist and notes cleared) |
| `CandidateProfile`, `ResumeFile` | `Job` (status back to NEW, `finalScore` and `filterReason` cleared) |
| `Application` and its cascade: `EmailDraft`, `EmailMessage`, `PortalAttempt`, `ApplicationEvent` | `JobSourceLink` |
| `ApplyBatch`, `PortalBatch` | `ScrapeTarget` |
| `JobScore` | `SponsorRegister` |
| `InboxMessage`, `Notification` | `BannedPhrase` |
| `AnswerBank`, `PortalAccount`, `OAuthToken` | `HostProfile` (logged out, notes cleared) |
| `AiKey`, `AiUsage`, `ServiceKey`, `ApiQuota` | `SiteLesson` |
| `SearchRun` (with its sources and logs), `SourceCursor` | `SuppressedAddress` bounces (manual entries deleted, links to applications cleared) |
| `Settings` (recreated with defaults) | `BoardDiscoveryRun`, `BoardDiscoveryLog` |
| Files under `storage/`: `apply-files`, `apply-shots`, `photo.*`, Chrome profiles, `browser`, `logs`, `backups`, Telegram caches, legacy lesson files | |

Not touched by the removal: `WorkerStatus` (heartbeats) and `ContactDiscoveryRun` (progress counters
of contact batches).

The **knowledge pack** (`database/knowledge`, `scripts/knowledge-lib.ts`) is the shareable form of
the right-hand column: companies (role mailboxes only), sponsors, scrape targets, banned phrases,
site profiles and scrubbed site lessons, plus optionally the jobs (`--jobs`, kept out of git).
`npm run db:seed` imports it into a new database; import only adds missing rows.

## Accounts and guards

- No user -> every page goes to `/setup` (`src/app/setup`), which creates the one account and
  redirects to `/login?created=1`.
- `src/proxy.ts` lets only the public paths through without a session; the `(app)` layout sends a
  user without `onboardedAt` to `/onboarding`.
- "Continue with Google" (optional) only signs in the existing owner whose email matches.

## Privacy guard

`npm run check:privacy` (`scripts/check-privacy.mjs`) scans every file git would publish, including
the decompressed knowledge pack, for personal mailbox addresses and long phone numbers outside the
fictional personas, plus every entry of an optional, gitignored `.privacy-denylist`. Tests use the
fictional people Alex Rivera and Sam Okafor only.
