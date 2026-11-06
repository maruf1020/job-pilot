@AGENTS.md

# Job Pilot: guide for coding agents

Self-hosted job search assistant for one person per install, any profession: finds jobs (many
sources + company ATS boards), ranks them against the person's profile with AI, drafts and sends
emails from Gmail, fills application forms with a browser agent, tracks replies. Public README:
`README.md`; module map and data flow: `docs/ARCHITECTURE.md`; the plan behind the public edition:
`docs/PLAN.md`.

## Stack

Next.js 16 App Router (APIs differ from older versions: read `node_modules/next/dist/docs/` before
touching routing or server actions), React 19, Tailwind v4 + shadcn/ui, Prisma 7 (client generated
at `src/generated/prisma`, import `db` from `@/lib/db`), Postgres 16, pg-boss workers
(`src/worker`), patchright/Playwright, Vitest, Playwright e2e.

## Commands

- `docker compose up -d` (Postgres `job-pilot-postgres`, port 5546), `npm install`,
  `npx prisma migrate deploy`, `npm run db:seed`
- `npm run dev` (port 3012; also starts the search/apply workers, `NO_WORKERS=1` skips)
- `npm test` (Vitest), `npx vitest run <paths>`, `npm run typecheck`, `npm run lint`
- `npm run test:e2e:prepare` then `npm run test:e2e` (own `<db>_e2e` database, port 3100)
- `npm run worker:search` / `worker:apply` (supervised by `scripts/workers.mjs`, logs in `storage/logs`)
- `npm run db:migrate` after schema edits, then restart the dev server and the workers
- `npm run check:privacy` before every commit

## Layout

- `src/app` routes: `(app)` pages, `(auth)/login`, `(onboarding)/onboarding`, `setup`, `api/*`
- `src/lib/candidate` the person (CandidateContext) - `src/lib/ai` providers, adapters, router,
  prompts - `src/lib/keys` key storage and importer - `src/lib/sources` job sources -
  `src/lib/pipeline` search run, drafting, batches - `src/lib/apply` browser agent -
  `src/lib/email`, `src/lib/mail` sending and mailbox - `src/lib/account` export / remove data -
  `src/lib/settings` settings schema and derive-from-profile
- `src/worker` worker entry (`start.ts`), roles, scheduler - `prisma/` schema, baseline migration,
  seed - `database/knowledge` shipped knowledge pack - `scripts/` CLIs - `e2e/` Playwright specs

## Rules

- **Nothing about a person in code.** Names, contact details, location, citizenship, work rights,
  employers, schools, salary, diversity answers and email-voice preferences come from the database
  through `src/lib/candidate/context.ts` (`loadCandidateContext()` in `load.ts`, or the `candidate`
  field of `ProfileForPrompt`). A missing answer degrades to neutral text or "needs the person",
  never to a hard-coded value. No profession, country or tech-stack assumptions either.
- Shared knowledge (site lessons, notes) is stored through `scrubPersonal` and read through
  `fillPlaceholders`.
- Tests and fixtures use the fictional personas only: **Alex Rivera** (alex.rivera@example.com,
  +351 912 345 678, Lisbon, Portugal, they/them) and **Sam Okafor** (Lagos, Nigeria, needs
  sponsorship, he/him). Never a real person.
- Nothing may send real email or messages from tests or scripts; reserved domains
  (`.example`, `.test`, `.invalid`) are refused by the sender on purpose.
- The browser agent never solves CAPTCHAs and never signs in or types passwords on sign-in walls;
  keep it that way.
- Run `npm run check:privacy` before committing; add personal words to the local, gitignored
  `.privacy-denylist`.
- Code style: TypeScript, 2 spaces, no semicolons, single quotes, comments that explain why (not
  who asked), plain ASCII (straight quotes, "-" not em dashes).
