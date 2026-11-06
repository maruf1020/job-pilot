import { describe, expect, it } from 'vitest'
import { validateSelect, wrapLimited } from './sql-guard'

const ok = (sql: string) => expect(validateSelect(sql), sql).toMatchObject({ ok: true })
const bad = (sql: string, reason?: RegExp) => {
  const r = validateSelect(sql)
  expect(r.ok, sql).toBe(false)
  if (reason && !r.ok) expect(r.reason).toMatch(reason)
}

describe('sql guard: accepts normal read queries', () => {
  it('plain selects, joins, aggregates', () => {
    ok('SELECT count(*) FROM "Application" WHERE status = \'SENT\'')
    ok('SELECT j."companyName", j."finalScore" FROM "Job" j WHERE j."finalScore" >= 70 ORDER BY j."finalScore" DESC LIMIT 10')
    ok('SELECT a.status, count(*) AS n FROM "Application" a JOIN "Job" j ON j.id = a."jobId" WHERE j."countryCode" = \'DE\' GROUP BY a.status')
    ok('select avg("finalScore") from "Job" where "finalScore" is not null')
  })

  it('CTEs and subqueries', () => {
    ok('WITH sent AS (SELECT "jobId" FROM "Application" WHERE "sentAt" IS NOT NULL) SELECT count(*) FROM sent')
    ok('WITH a AS (SELECT id FROM "Job"), b AS (SELECT id FROM a) SELECT count(*) FROM b')
    ok('SELECT * FROM (SELECT "companyName", count(*) c FROM "Job" GROUP BY 1) x ORDER BY c DESC')
  })

  it('local-time date math', () => {
    ok(`SELECT count(*) FROM "Application" WHERE ("sentAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Lisbon')::date = (now() AT TIME ZONE 'Europe/Lisbon')::date`)
    ok(`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Lisbon') AS d, count(*) FROM "EmailMessage" WHERE direction = 'OUTBOUND' GROUP BY 1 ORDER BY 1 DESC LIMIT 7`)
    ok(`SELECT extract(hour from "sentAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Lisbon') h, count(*) FROM "Application" GROUP BY 1`)
    ok(`SELECT "companyName" FROM "Job" WHERE title ILIKE '%react%' AND "firstSeenAt" > now() - interval '7 days'`)
  })

  it('statements that only mention keywords inside string literals', () => {
    ok(`SELECT count(*) FROM "EmailMessage" WHERE subject ILIKE '%update%' OR subject ILIKE '%delete this; drop it%'`.replace('; ', ' '))
  })
})

describe('sql guard: rejects everything that is not one read query', () => {
  it('writes and DDL', () => {
    bad('INSERT INTO "Job"(id) VALUES (1)', /SELECT or WITH/)
    bad('UPDATE "Application" SET status = \'SENT\'', /SELECT or WITH/)
    bad('DELETE FROM "Application"', /SELECT or WITH/)
    bad('DROP TABLE "Job"')
    bad('TRUNCATE "Job"')
    bad('ALTER TABLE "Job" ADD COLUMN x int')
    bad('CREATE TABLE x (a int)')
    bad('GRANT ALL ON "Job" TO public')
    bad('COPY "Job" TO PROGRAM \'curl x\'')
  })

  it('writes hidden in a WITH, and SELECT INTO', () => {
    bad('WITH d AS (DELETE FROM "Application" RETURNING *) SELECT * FROM d', /DELETE/)
    bad('WITH u AS (UPDATE "Job" SET title = \'x\' RETURNING *) SELECT * FROM u', /UPDATE/)
    bad('WITH i AS (INSERT INTO "Job"(id) VALUES (1) RETURNING *) SELECT * FROM i', /INSERT/)
    bad('SELECT * INTO newtable FROM "Job"', /INTO/)
  })

  it('multi-statement, comments, dollar quoting, backslashes', () => {
    bad('SELECT 1; SELECT 2', /semicolon/)
    bad('SELECT 1;', /semicolon/)
    bad('SELECT 1 -- hi', /Comments/)
    bad('SELECT /* x */ 1', /Comments/)
    bad('SELECT $$x$$', /Dollar/)
    bad("SELECT E'\\x'", /Backslash/)
    bad("SELECT 'unterminated")
  })

  it('locking clauses', () => {
    bad('SELECT * FROM "Application" FOR UPDATE', /locking|UPDATE/i)
    bad('SELECT * FROM "Application" FOR SHARE', /locking/i)
    bad('SELECT * FROM "Application" FOR NO KEY UPDATE', /locking|UPDATE/i)
  })

  it('dangerous functions and catalogs', () => {
    bad('SELECT pg_sleep(10)', /pg_sleep/)
    bad('SELECT pg_read_file(\'/etc/passwd\')', /pg_read_file/)
    bad("SELECT set_config('x','y',false)", /set_config/)
    bad("SELECT current_setting('x')", /current_setting/)
    bad("SELECT dblink('host=x','select 1')", /dblink/)
    bad('SELECT lo_import(\'/etc/passwd\')', /lo_import/)
    bad("SELECT query_to_xml('select 1', true, true, '')", /query_to_xml/)
    bad("SELECT nextval('s')", /nextval/)
    bad('SELECT * FROM information_schema.tables', /catalog/i)
    bad('SELECT * FROM pg_catalog.pg_tables', /catalog/i)
    bad('SELECT * FROM pgboss.job', /catalog|pgboss/i)
    bad('SELECT version()', /version/)
    bad('SELECT current_user', /current_user/)
  })

  it('denied tables, in any quoting or case', () => {
    for (const t of ['User', 'AiKey', 'OAuthToken', 'PortalAccount', 'ApiQuota', 'Settings', 'CandidateProfile', 'ResumeFile']) {
      bad(`SELECT * FROM "${t}"`, /not allowed|Unknown/)
      bad(`select * from ${t.toLowerCase()}`)
      bad(`SELECT count(*) FROM "Job" j JOIN "${t}" x ON true`)
      bad(`SELECT a.id FROM "Job" a, "${t}" b`)
    }
  })

  it('tables outside the allowlist', () => {
    bad('SELECT * FROM "Mystery"', /Unknown or not allowed/)
    bad('SELECT * FROM public."Mystery"', /Unknown or not allowed/)
  })

  it('columns that look like secrets', () => {
    bad('SELECT "encryptedPassword" FROM "Job"', /Column not allowed/)
    bad('SELECT token FROM "Job"', /Column not allowed/)
    bad('SELECT "apiKey" FROM "Job"', /Column not allowed/)
    bad('SELECT "clientSecret" FROM "Job"', /Column not allowed/)
    bad('SELECT "dedupeKey" FROM "Job"', /Column not allowed/)
    bad('SELECT "passwordHash" FROM "Job"', /Column not allowed/)
  })

  it('session control and transaction keywords', () => {
    bad('SET statement_timeout = 0')
    bad('SELECT 1 WHERE (SELECT 1) = 1) OR (1=1', /parenthes/i)
    bad('BEGIN')
    bad('COMMIT')
    bad('EXPLAIN ANALYZE SELECT 1', /SELECT or WITH/)
    bad('')
    bad('x'.repeat(5000))
  })

  it('an injection through the closing parenthesis of the wrapper', () => {
    bad('SELECT 1) AS t; DROP TABLE "Job"; SELECT * FROM (SELECT 1')
    bad('SELECT 1) t UNION ALL (SELECT 2', /parenthes/i)
  })
})

describe('wrapLimited', () => {
  it('wraps in an outer select with a hard row limit', () => {
    expect(wrapLimited('SELECT 1')).toBe('SELECT * FROM (SELECT 1) AS t LIMIT 50')
    expect(wrapLimited('SELECT 1', 5000)).toBe('SELECT * FROM (SELECT 1) AS t LIMIT 50')
    expect(wrapLimited('SELECT 1', 10)).toBe('SELECT * FROM (SELECT 1) AS t LIMIT 10')
  })
})
