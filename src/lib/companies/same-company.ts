/**
 * One company under different spellings: "Instabee AB", "instabee.teamtailor.com", "CHAOS Industries" and
 * "Chaosindustries". The rule is one application per company per 15 days, and the same company had two
 * records (two ids), so CHAOS Industries got a second application four days after the first.
 */

/** Lowercased name without legal form, careers-site host or punctuation ("Datawords GmbH" → "datawords"). */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    // startup.jobs wrote "Job  Tether Operations Limited" (two spaces), so a second Tether application slipped
    // past the 15-day rule. Real names like "Job Squad" have one space and stay.
    .replace(/^job\s{2,}/, '')
    .replace(/^(?:www|jobs|careers?|apply|join)\./, '')
    .replace(/\.(?:jobs\.)?(?:teamtailor|recruitee|personio|workable|breezy|bamboohr|join|zohorecruit|smartrecruiters|lever|greenhouse|ashbyhq)\.[a-z.]+$/, '')
    .replace(/\.(?:com|de|io|eu|net|org|co|hr|nl|se|dk|pl|es|pt|fr|it|co\.uk)$/, '')
    .replace(/\b(?:gmbh|ltd|limited|inc|b\.?v|ab|a\/s|as|sa|sl|s\.?l\.?u|spa|srl|llc|plc|ag|oy|group|se)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The same key without spaces, so "CHAOS Industries" and "Chaosindustries" are one company. */
export function sameCompanyKey(name: string): string {
  return companyKey(name).replace(/ /g, '')
}
