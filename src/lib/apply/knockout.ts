import type { Page } from 'playwright'

/**
 * Knockout gates: after a truthful "No" (live in Berlin? hold an EU permit?) the form says the person does not
 * meet a requirement and greys out every field (Teamtailor in every language, varm.teamtailor.com,
 * careers.gowish.com). Nothing can be submitted, so the job is closed as not eligible, not left for the user.
 */
export const KNOCKOUT_RE = new RegExp(
  [
    'you (have|need|must) to meet (these|the following|the) requirements',
    'you must meet (these|the following|all of the) requirements',
    'um sich bewerben zu können,? müssen sie (die )?folgende(n)? voraussetzungen erfüllen',
    'um dich bewerben zu können,? musst du (die )?folgende(n)? voraussetzungen erfüllen',
    'pour (pouvoir )?postuler,? vous devez (remplir|satisfaire|répondre)',
    'para (poder )?(postular|presentar tu candidatura|aplicar|solicitar),? (debes|tienes que|necesitas) cumplir',
    'om te kunnen solliciteren,? (moet je|dien je) (voldoen|aan de volgende)',
    'för att (kunna )?söka (måste|behöver) du uppfylla',
    'for at (kunne )?(søge|ansøge),? skal du (opfylde|leve op)',
    'per (poter(ti)? )?candidar(ti|si),? (devi|è necessario) soddisfare',
    'aby (móc )?aplikować,? musisz spełni',
    'jotta voit hakea,? sinun (on|täytyy) täyttää',
    'for å (kunne )?søke,? må du oppfylle',
    // The same gate without its "to apply" lead-in (Spanish Teamtailor, convotisiberia).
    '(tienes que|debes|hay que) cumplir (con )?(estos|los siguientes) requisitos',
    '(sie müssen|du musst) (diese|folgende) (voraussetzungen|anforderungen) erfüllen',
    'vous devez (remplir|satisfaire) (ces|les) (conditions|exigences)',
  ].join('|'),
  'i',
)

/** "You have already applied to this position": the site (or its Submit answer) says the application is in. */
export const ALREADY_APPLIED_RE = /already applied (to|for) this (position|job|role|vacancy)|you (have )?already applied|application (has )?already been (submitted|received)/i

/** Pages that hold the application until the person clicks a link in an email (Teamtailor email_verification_needed). */
export const EMAIL_VERIFY_URL_RE = /email[_-]?verification|verify[_-]?(your[_-]?)?email|confirm[_-]?(your[_-]?)?email/i

/** The text of the page and every frame in it (forms often live in an ATS iframe). */
async function allText(page: Page): Promise<string> {
  const parts = await Promise.all(page.frames().map((f) => f.evaluate(() => document.body?.innerText ?? '').catch(() => '')))
  return parts.join('\n')
}

/** The knockout sentence on the page, or null. */
export async function knockoutText(page: Page): Promise<string | null> {
  const m = (await allText(page)).match(KNOCKOUT_RE)
  return m ? m[0].slice(0, 160) : null
}

/** The "already applied" sentence on the page, or null. */
export async function alreadyAppliedText(page: Page): Promise<string | null> {
  const m = (await allText(page)).match(ALREADY_APPLIED_RE)
  return m ? m[0].slice(0, 160) : null
}
