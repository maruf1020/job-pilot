/** Recognise the applicant tracking system from an apply URL. */
const ATS_HOSTS: Array<[RegExp, string]> = [
  [/greenhouse\.io/i, 'greenhouse'],
  [/lever\.co/i, 'lever'],
  [/ashbyhq\.com/i, 'ashby'],
  [/workable\.com/i, 'workable'],
  [/smartrecruiters\.com/i, 'smartrecruiters'],
  [/myworkdayjobs\.com|workday\.com/i, 'workday'],
  [/personio\.(de|com)|jobs\.personio/i, 'personio'],
  [/teamtailor\.com/i, 'teamtailor'],
  [/recruitee\.com/i, 'recruitee'],
  [/bamboohr\.com/i, 'bamboohr'],
  [/jobvite\.com/i, 'jobvite'],
  [/icims\.com/i, 'icims'],
  [/successfactors\.(com|eu)/i, 'successfactors'],
  [/taleo\.net/i, 'taleo'],
  [/join\.com/i, 'join'],
  [/comeet\.com/i, 'comeet'],
  [/breezy\.hr/i, 'breezy'],
  [/applytojob\.com|jazz\.co|jazzhr/i, 'jazzhr'],
  [/pinpointhq\.com/i, 'pinpoint'],
  [/dover\.com/i, 'dover'],
  [/rippling\.com/i, 'rippling'],
  [/homerun\.co/i, 'homerun'],
  [/welcometothejungle\.com/i, 'wttj'],
]

export function detectAts(url: string | null | undefined): string | null {
  if (!url) return null
  for (const [re, name] of ATS_HOSTS) if (re.test(url)) return name
  return null
}
