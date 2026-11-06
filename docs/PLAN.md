# Public edition plan: shareable, any-user, any-AI-provider job finder

Status: proposed 2026-11-06. Source app: `L:/Github/personal/ai-job-finder` (stays exactly as it is).

## 0. Decisions already made

| Topic | Decision |
|---|---|
| Source app | Unchanged. Same repo, DB, workers, port 3011. Nothing in it is edited. |
| Public app | New folder + fresh git repo (one clean first commit, no old history). |
| Database | Its own Postgres container, volume, port and docker-compose. Never the source DB. |
| Workers | Its own workers, process names, lock files, Chrome profile and CDP port, so the two apps can run side by side and never see or restart each other. |
| Knowledge | Shipped "fully trained": companies, jobs (scores and user status removed), job boards, sponsor registers, site playbooks, form lessons, banned phrases. |
| Personal data | None in code, tests, docs or seed. Everything about a user lives in the database and is entered through the app. |
| Users | One owner per install. First run creates the account (name + password), then logs out, then the owner logs in and fills the onboarding form. |
| Remove my data | A Settings action wipes everything about the user and keeps the shared knowledge, so the DB can be handed to someone else. |
| AI | Any provider. Keys added manually or bulk-imported (paste `.env` text or a file); the provider is detected from the variable name, then the key format, then a live probe. |

## 1. New project and isolation

- Location: `L:/Github/personal/job-pilot` (name chosen by the owner).
- Copy the source working tree, including the uncommitted Workday and board-finder fixes. Leave out:
  - `.git`, `node_modules`, `.next`, `src/generated`, `playwright-report`, `test-results`, `tsconfig.tsbuildinfo`
  - `storage/`, `state/`, `e2e/.auth`, `.env*` (except the examples), `.mcp.json`
  - `*.pdf`, `New Text Document.txt` (it contains keys)
  - `plan*.md`, `plan-apply-all-evidence/`, `docs/INBOX_REVIEW_*`
- Isolation from the source app:

  | Thing | Source app | Public app |
  |---|---|---|
  | App port | 3011 | 3012 |
  | Postgres | `ai-job-finder-postgres` :5545 | `job-pilot-postgres` :5546, own volume |
  | Worker supervisor | `scripts/worker-forever.mjs` | `scripts/workers.mjs` (new name) |
  | Worker entry | `src/worker/index.ts` | `src/worker/start.ts` (new name) |
  | Locks / logs | `storage/locks` in the source folder | the public folder's own `storage/` |
  | Agent Chrome CDP | 9334 | 9335 (from settings) |

  The source app's ops scripts look for `worker-forever.mjs` and `src[\\/]worker[\\/]index`. The new names guarantee they can never match, stop or restart the public app's workers, and the reverse holds too. Process detection in the public app also matches its own folder path, never a global name.
- Squash the Prisma migrations into one new baseline migration. A fresh DB needs no history, and the old init migration had the previous owner's defaults (timezone, location) written into it.

## 2. Data model changes

- **User**: `username` (unique, case-insensitive, used to log in), `displayName`, `email` optional, `sessionVersion` (bumped on wipe or password change so every old login cookie stops working), `onboardedAt`.
- **CandidateProfile**: extended so nothing about a person has to be in code. New fields:
  - Name: `givenName`, `familyName`, `preferredName`, `pronouns`
  - Contact: `phoneCountryCode`, `phone`, `links` (LinkedIn, GitHub, portfolio, Behance, Dribbble, X, other)
  - Location: `city`, `region`, `country`, `timezone`, `citizenships[]`
  - `profession`: software | design | data | product | marketing | other, with free-text `field`
  - `seniority[]`
  - `workAuth`: `needsSponsorship`, `rightToWorkCountries[]`, `authorizationText`
  - `relocation`: yes | no | maybe, `remote`: only | ok | no
  - `languages`: `[{name, level}]`
  - `degree`, `gpa`: optional
  - `diversity`: optional, every item defaults to "Prefer not to say"
  - `emailVoice`: tone, `neverMention[]`, `leadWith[]`, sign-off
  - `noticePeriod`, `earliestStart`, `salary` (expectation, currency, "only when asked" switch), `howHeard`
  - Existing fields stay: summary, skills, titles, facts, experience, education, signature and the rest.
- **Settings**: default timezone `UTC`. Defaults for queries, countries, stack keywords and title rules become empty or neutral. Onboarding derives them from the profile.
- **AiKey** becomes provider-generic:
  - `provider`, `baseUrl` (custom or OpenAI-compatible endpoints)
  - `keyHash` (unique sha256, for de-duplication), `source` (manual | import)
  - `models` (discovered list), `primaryModel`, `liteModel`
  - `capabilities` (json, vision, webSearch)
  - `priority`, `dailyLimit`, `monthlyBudgetUsd`, `lastTestedAt`, `status`
- **ServiceKey** (new): credentials for non-AI services, so they can be entered in the app and are not tied to `.env`. Covers Adzuna, Jooble, RapidAPI, Reed, France Travail, Sapling, Google CSE, Telegram bot + chat, ntfy, SMTP. Values encrypted; `.env` stays as an optional fallback.
- **AiUsage**: adds `provider`.
- **SiteLesson** (new): moves `storage/site-playbooks.jsonl` and `fix-lessons.jsonl` into the DB as shared knowledge (host, kind, lesson, source, hits).

## 3. Accounts and first run

1. No user exists → every page redirects to `/setup`. It asks for a name and password (twice), with argon2 hashing.
2. After the account is created the app signs out and shows `/login` with "Account created, please log in".
3. Login is by name + password, with the existing 5-try lockout.
4. Logged in, but `onboardedAt` is empty → every page redirects to `/onboarding`.
5. Remove the hard-coded seed user, `ADMIN_EMAIL` / `ADMIN_PASSWORD`, and the seeded owner name.
6. `requireUser()` and the page guard check that the user row still exists and that `sessionVersion` matches. After a wipe, old cookies stop working at once.
7. Google sign-in and Gmail connect stay optional and are linked to the owner after login.
8. New Settings tab **Account**: change name, change password, and the Danger zone (section 6).

## 4. Onboarding form (the "big form")

A multi-step wizard. Each step saves, so the owner can leave and come back. Every field can be edited later in Settings > Profile.

1. **AI keys** (optional, recommended). Paste or import keys, or skip. With a key, the CV can fill the form automatically.
2. **CV upload**. PDF; AI parsing pre-fills the next steps when a key exists.
3. **Who you are**: name parts, pronouns, email, phone with country code, links, photo (optional).
4. **Where you live and can work**: city, country, timezone, citizenships, sponsorship need, right-to-work countries, relocation, remote preference.
5. **What you want**: profession (developer, designer, data, product, marketing, other), target titles, seniority, skills, title words to exclude.
6. **Where to look**: countries with priority tiers, remote-only switch, minimum salary and currency, languages.
7. **Experience and education**: reviewed and edited from the CV parse.
8. **Standard form answers**: notice period, earliest start, salary policy, how you heard, degree, GPA. Diversity questions are optional, defaulting to "Prefer not to say".
9. **Email voice**: tone, topics to never mention, skills to lead with, signature.
10. **Review and finish.**
    - Writes the profile.
    - Builds Settings from it: search queries from titles, ranking keywords from skills, countries and tiers, title rules.
    - Seeds the AnswerBank from it.
    - Sets `onboardedAt` → dashboard.

## 5. Remove every personal assumption from code

A new `getCandidateContext()` builds a typed context object from the profile and settings. Every prompt, rule and form filler reads from it:

- `src/lib/ai/prompts/index.ts`
  - Replace the owner's name, dial code, city/time zone, citizenship, sponsorship facts, gender line, "why leaving" and the topic he never wanted mentioned with context fields (`neverMention`, `leadWith`).
  - The rank prompt's "5+ years, AWS…" comes from the profile.
- `src/lib/apply/standard.ts`
  - Phone, address, school, GPA, language list, former-employer regex (built from `profile.experience`), degree-year heuristic, gender, veteran status, office Yes, how-heard order and the 4-month start date all come from the profile.
  - The diversity word lists become neutral synonym tables.
- `src/lib/apply/answer-bank.ts`: defaults come from the new profile fields; no country or sponsorship assumptions.
- `src/lib/apply/driver.ts`, `fixer.ts`, `ask.ts`, `fill.ts`, `adapters/*`, `applications/conversations.ts`
  - Seed lessons and facts become templated from the context.
  - `truthfulWorkAnswer` reads `workAuth`.
- `src/lib/pipeline/quality-gate.ts`: the modest salary asks come from the profile's salary settings.
- Ranking and filtering by profession:
  - `ranking/rules.ts` and `pipeline/prefilter.ts`: the JS/TS stack regexes are built from the profile's skills.
  - Developer-only rules (stack mismatch, other-stack exclusion) run only when the profession is software.
  - Title rules (`devTitlesOnly` and friends) become generic "target titles + seniority" rules, so a designer gets design jobs.
- `sponsors/gemini-discovery.ts`, `telegram/release.ts`: the focus text comes from the profile.
- Timezone: the fixed-offset Telegram time helper is replaced by one that reads `Settings.timezone`. This covers telegram stats/status/metrics, the agent SQL prompt, and the local-time log column.
- Ops briefs (`scripts/ops/*.md`): rewritten as generic templates that read the profile. Absolute `L:/...` paths become relative. Memory-file paths and personal rules are removed.

## 6. Remove my data (Settings > Account > Danger zone)

- **Confirm**: type the account name and password.
- **Order**:
  1. Pause and cancel the apply and email batches; stop the browser agents.
  2. Purge queued pg-boss jobs.
  3. Delete Applications (this cascades drafts, emails, attempts and events), then ApplyBatch and PortalBatch.
  4. Delete JobScore. Reset each Job's `status` to NEW and clear `finalScore` / `filterReason`.
  5. Delete InboxMessage, Notification, AnswerBank, PortalAccount, OAuthToken, AiUsage, AiKey, ServiceKey, ResumeFile, CandidateProfile.
  6. Delete SearchRun (cascades), SourceCursor.
  7. Reset Settings to defaults. Set `Company.blacklisted` false and clear `Company.notes`. Set `HostProfile.loggedIn` false and clear `notes`. Null out `SuppressedAddress.applicationId` and delete manual rows.
  8. Delete the User.
  9. Delete files: `storage/apply-files`, `apply-shots`, `photo.*`, the chrome profiles, logs, the telegram caches.
- **Kept**: Company, Job (unscored), JobSourceLink, ScrapeTarget, SponsorRegister, BannedPhrase, HostProfile, SiteLesson, SuppressedAddress (bounces), BoardDiscovery history.
- **After**: the app signs out and goes to `/setup`.
- An "Export my data first" button downloads a JSON of the profile, answers and applications before the wipe.
- A CLI twin, `npm run data:remove-user -- --yes`, does the same for headless installs.

## 7. AI providers: any key, manual or imported

- **Provider registry** (`src/lib/ai/providers.ts`). Each provider has id, label, adapter, base URL, key patterns, env variable names, default primary/lite models, and vision / JSON-mode / web-search support.
  - Gemini (native)
  - Anthropic Claude (native)
  - OpenAI-compatible:
    - Big providers: OpenAI (Codex / GPT), DeepSeek, Moonshot Kimi, Groq, OpenRouter, Mistral, xAI Grok
    - Hosted open models: Together, Fireworks, Cerebras, Perplexity, Alibaba Qwen, Zhipu GLM
    - Local: Ollama / LM Studio
    - Custom (any base URL)
- **Adapters**: `gemini.ts`, `anthropic.ts` and `openai-compat.ts` share one contract, `call() → {text, usage, finishReason}`, plus `classifyError`, `testKey` and `listModels`.
  - JSON: a native schema where the provider supports it, otherwise the schema goes in the prompt.
  - Validation stays shared: zod parse, repair and retry, exactly as today.
  - Images: sent as each provider's image block. Calls with screenshots only go to vision-capable keys, with a text-only fallback.
  - Web search: Gemini grounding, Anthropic web_search, OpenRouter online. Elsewhere it is skipped (both callers already handle that).
- **Router**: `generateJson` / `generateText` keep their signatures, so none of the ~33 call sites change.
  - The router picks keys by the owner's provider priority, the task tier (primary / lite → per-key model) and the capabilities the call needs.
  - It keeps today's 429 / daily-quota / 5xx handling, per provider.
  - Budgets: free daily limits per key and model; paid keys get a daily-call or monthly-USD cap. The "lite left" and "primary left" summaries become the sum across providers.
- **Import** (Settings > AI keys > Import, and onboarding step 1):
  - Paste text or drop a `.env`, `.txt` or `.json` file.
  - Parse `NAME=value` lines, JSON objects and bare keys.
  - Detection order:
    1. Variable name (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `KIMI` / `MOONSHOT`, …)
    2. Key format (`AIza…` / `AQ.` → Gemini, `sk-ant-` → Anthropic, `sk-proj-` → OpenAI, `sk-or-` → OpenRouter, `gsk_` → Groq, `xai-` → xAI, `pplx-` → Perplexity, `csk-` → Cerebras, `fw_` → Fireworks)
    3. A live probe of the candidate providers' model-list endpoints, for plain `sk-…` or prefix-less keys
  - A preview table shows the detected provider, how it was detected, the test result and the suggested models. Duplicates (same hash) are skipped. Import only after confirming.
  - The same importer also recognises service keys (Adzuna, Telegram, …) and stores them as ServiceKey.
- **Manual add**: a provider dropdown (plus a custom base URL), Test, Discover models, and the primary/lite model choice.
- **Remove auto-seeding**: `GEMINI_API_KEYS` / `ANTHROPIC_API_KEY` are no longer copied into the pool on every worker start. Otherwise a wipe would bring the keys straight back. `.env` keys are imported only on purpose, with the Import from .env button.
- **Fixes**: `fixer.ts` passes a tier instead of a hard-coded Gemini model id. Stats and status texts say "AI" instead of "Gemini".

## 8. Shared knowledge ("fully trained")

- **One-time copy from the source DB into the new DB**, read-only on the source:
  - Company: `blacklisted` false, `notes` cleared
  - Job: status NEW, score/filter cleared, enrichment kept
  - JobSourceLink, ScrapeTarget, SponsorRegister, BannedPhrase
  - HostProfile: `loggedIn` false, notes scrubbed
  - SuppressedAddress: bounces only
  - SiteLesson from the scrubbed jsonl files
- **Scrubber**: drops or rewrites any lesson or note containing the owner's identifiers. The denylist is built at run time from the source profile and is never written into the repo. A generic phone/email regex also runs. Afterwards a check script proves zero hits.
- **Shipped in the repo** (`database/knowledge/*.json.gz`, so a fresh clone is trained): companies, job boards, banned phrases, host profiles and site lessons.
  - `npm run knowledge:import` loads them into an empty DB; `knowledge:export` regenerates them.
  - Sponsor registers are shipped if they are a reasonable size compressed; otherwise refreshed by the existing loader.
  - Jobs (141k rows, about 460 MB) are not shipped in git. They go into the owner's new DB by the one-time copy, and `knowledge:export --jobs` can write a separate dump file to share.

## 9. Repo content for the public

- **Delete**: the plans, evidence, inbox review and CV. Keep generic docs (`MAIL_PLAN`, generalised).
- **Tests and fixtures**: rewritten with a fictional person (Alex Rivera, Lisbon, Portugal, fake phone, example.com email, designer and developer variants). Same coverage.
- **README**: rewritten as a public setup guide (Docker, env, first run, onboarding, keys, Gmail optional, workers). Plus a new `.env.example` with only install-level values (`DATABASE_URL`, `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `APP_URL`, optional Google OAuth client).
- **Privacy guard**: `npm run check:privacy` scans the repo for generic personal patterns, plus an optional untracked local denylist file. It runs in `npm test`.

## 10. Phases (in order)

1. Scaffold: copy, isolate (ports, names, compose), fresh git, baseline migration. Build + tests pass as a copy.
2. Schema: new fields and tables, CandidateContext, providers registry.
3. Accounts: setup → logout → login by name → onboarding guard; Account tab.
4. Onboarding wizard + derive settings and answer bank.
5. Generalise the code: prompts, standard answers, driver, ranking/prefilter by profession, timezone.
6. AI: adapters, router, importer, key UI, usage and budgets.
7. Remove my data (UI + CLI) and export.
8. Knowledge: copy from the source DB, scrubber, shipped knowledge pack, import/export scripts.
9. Public cleanup: delete files, fictional fixtures, README, `.env.example`, privacy check, ops briefs.
10. Verification (section 11), then the first commit in the new repo. The new repo is pushed to GitHub only when the owner asks.

## 11. Verification

- Unit tests and typecheck pass. New tests cover: key detection (each format, each env name, ambiguous → probe), router fallbacks and capability filtering, the CandidateContext prompt output for the developer and designer fixtures, the wipe (what is deleted and what is kept), and the setup/onboarding guards.
- End-to-end in a real browser on the new app:
  1. Fresh DB → `/setup` → create the account → logged out → log in by name.
  2. Onboarding with a fictional designer CV.
  3. A search runs and ranks with a non-Gemini key.
  4. Remove my data → `/setup`. The kept tables keep their counts.
- `check:privacy` reports 0 hits, and a grep for the owner's identifiers across the new repo finds nothing.
- Fresh-clone test: clone into a temp folder, `docker compose up`, migrate, `knowledge:import`, first run works.
- The source app is untouched: `git status` is unchanged in the source repo, its workers keep running, and port 3011 still answers.

## 12. Risks

- The phone/address/name logic in `standard.ts` and `fill.ts` is subtle. Generalising it can break live form filling. Mitigation: keep the logic, swap only the values, and run the existing form fixtures against the fictional persona.
- Providers differ on JSON schema and vision. Mitigation: shared zod validation + retry, schema-in-prompt fallback, capability filtering.
- The knowledge scrub must be complete. Mitigation: a run-time denylist from the source profile, plus a generic phone/email scan, plus a check script with 0 hits as the gate.
