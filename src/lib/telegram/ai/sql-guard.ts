import { ALLOWED_TABLES, DENIED_TABLES } from './schema-text'

/**
 * Read-only enforcement in CODE, for SQL written by a model. Nothing here trusts the model:
 *  - exactly one SELECT / WITH ... SELECT statement (no semicolon, no comment, no dollar quoting),
 *  - no write, DDL, locking or session keywords, no INTO, no FOR UPDATE / SHARE,
 *  - no pg_* / information_schema / set_config / dblink / lo_* / copy style functions,
 *  - only tables from the allowlist (the schema minus sensitive tables) and no identifier that looks like a
 *    secret (token, secret, password, credential, key).
 * The transaction (sql-run.ts) is READ ONLY with a statement timeout as the second, independent guard.
 */

export const MAX_SQL_LENGTH = 4000
export const RESULT_ROW_LIMIT = 50

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string }

const reject = (reason: string): GuardResult => ({ ok: false, reason })

/** Removes 'string literals' (with '' escapes) so keywords inside them are not mistaken for SQL. */
export function stripLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, ' 0 ')
}

const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|exec|prepare|deallocate|vacuum|analyze|merge|into|lock|reset|set|listen|notify|unlisten|declare|fetch|move|refresh|reindex|cluster|discard|checkpoint|security|begin|commit|rollback|savepoint|abort|load|import|export|explain|show|values\s+into)\b/i

const FORBIDDEN_LOCKING = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i

const FORBIDDEN_FUNCTIONS =
  /\b(pg_\w*|set_config|current_setting|dblink\w*|lo_\w+|loread|lowrite|query_to_xml\w*|table_to_xml\w*|cursor_to_xml|database_to_xml|schema_to_xml|xmlquery|nextval|setval|currval|lastval|txid_\w+|current_database|current_schema|current_schemas|current_user|session_user|user|inet_server_addr|inet_server_port|version\s*\()/i

const FORBIDDEN_CATALOGS = /\b(information_schema|pg_catalog|pgboss|pg_toast)\b/i

/** Identifiers that look like secrets. Rejects any column or table whose name contains these. */
const SENSITIVE_IDENTIFIER = /[a-z0-9_]*(token|secret|password|passwd|credential|key)[a-z0-9_]*/i

const DENIED_TABLE_RE = new RegExp(`\\b(${DENIED_TABLES.map((t) => t.toLowerCase()).join('|')})\\b`, 'i')

const ALLOWED = new Set<string>(ALLOWED_TABLES.map((t) => t.toLowerCase()))

/** Table names that follow FROM / JOIN, after removing the FROM that belongs to a function (extract ... from). */
function relationNames(stripped: string): string[] {
  const cleaned = stripped
    .replace(/\b(extract|date_part)\s*\(\s*\w+\s+from\b/gi, '$1(x,')
    .replace(/\b(substring|trim|overlay|position)\s*\(([^()]*?)\bfrom\b/gi, '$1($2,')
    .replace(/\bis\s+(not\s+)?distinct\s+from\b/gi, ' = ')
  const names: string[] = []
  const re = /\b(?:from|join)\s+(?:only\s+)?(?:public\s*\.\s*)?"?([A-Za-z_][\w]*)"?(\s*\()?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned))) {
    if (m[2]) continue // a function in FROM (generate_series, unnest ...); functions are checked separately
    names.push(m[1].toLowerCase())
  }
  return names
}

function cteNames(stripped: string): Set<string> {
  const names = new Set<string>()
  const re = /(?:\bwith(?:\s+recursive)?|,)\s*"?([A-Za-z_]\w*)"?\s*(?:\([^)]*\)\s*)?as\s*(?:not\s+materialized\s*|materialized\s*)?\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) names.add(m[1].toLowerCase())
  return names
}

function parenthesesBalanced(stripped: string): boolean {
  let depth = 0
  for (const ch of stripped) {
    if (ch === '(') depth++
    else if (ch === ')' && --depth < 0) return false
  }
  return depth === 0
}

export function validateSelect(input: string): GuardResult {
  const sql = (input ?? '').trim()
  if (!sql) return reject('Empty query')
  if (sql.length > MAX_SQL_LENGTH) return reject('Query too long')
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(sql)) return reject('Control characters are not allowed')
  if (sql.includes(';')) return reject('Only one statement is allowed (no semicolons)')
  if (/--|\/\*|\*\//.test(sql)) return reject('Comments are not allowed')
  if (sql.includes('\\')) return reject('Backslashes are not allowed')
  if (sql.includes('$')) return reject('Dollar quoting and parameters are not allowed')

  const stripped = stripLiterals(sql)
  if (stripped.includes("'")) return reject('Unterminated string literal')
  if (!/^\s*\(*\s*(select|with)\b/i.test(stripped)) return reject('Only SELECT or WITH ... SELECT is allowed')
  if (!parenthesesBalanced(stripped)) return reject('Unbalanced parentheses')

  if (FORBIDDEN_LOCKING.test(stripped)) return reject('Row locking is not allowed')
  const kw = FORBIDDEN_KEYWORDS.exec(stripped)
  if (kw) return reject(`Keyword not allowed: ${kw[1].toUpperCase()}`)
  if (FORBIDDEN_CATALOGS.test(stripped)) return reject('System catalogs are not allowed')
  const fn = FORBIDDEN_FUNCTIONS.exec(stripped)
  if (fn) return reject(`Function not allowed: ${fn[1].replace(/\s*\($/, '')}`)

  const denied = DENIED_TABLE_RE.exec(stripped)
  if (denied) return reject(`Table not allowed: ${denied[1]}`)
  const sensitive = SENSITIVE_IDENTIFIER.exec(stripped)
  if (sensitive) return reject(`Column not allowed: ${sensitive[0]}`)

  const ctes = cteNames(stripped)
  const tables = relationNames(stripped)
  for (const t of tables) if (!ALLOWED.has(t) && !ctes.has(t)) return reject(`Unknown or not allowed table: ${t}`)

  return { ok: true, sql }
}

/** The outer wrapper: the model's own LIMIT cannot exceed it. */
export function wrapLimited(sql: string, limit = RESULT_ROW_LIMIT): string {
  return `SELECT * FROM (${sql}) AS t LIMIT ${Math.max(1, Math.min(limit, RESULT_ROW_LIMIT))}`
}
