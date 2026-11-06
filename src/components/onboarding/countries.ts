import { flagEmoji } from '@/lib/format'

/** ISO 3166-1 alpha-2 codes (current countries and territories). Names come from Intl.DisplayNames. */
const ISO2 =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ')

export interface CountryOption {
  value: string
  label: string
  flag: string
}

let cached: CountryOption[] | null = null

/** Every country, sorted by its English name. */
export function countryOptions(): CountryOption[] {
  if (cached) return cached
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    names = null
  }
  cached = ISO2.map((code) => {
    let label = code
    try {
      label = names?.of(code) ?? code
    } catch {
      label = code
    }
    return { value: code, label, flag: flagEmoji(code) }
  }).sort((a, b) => a.label.localeCompare(b.label))
  return cached
}

export function countryLabel(code: string | null | undefined): string {
  if (!code) return ''
  return countryOptions().find((c) => c.value === code.toUpperCase())?.label ?? code
}

/** IANA time zones the browser knows (a short fallback list on old engines). */
export function timezoneOptions(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (zones?.length) return zones.includes('UTC') ? zones : ['UTC', ...zones]
  } catch {
    // fall through
  }
  return ['UTC', 'Europe/London', 'Europe/Lisbon', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw', 'Africa/Lagos', 'Asia/Kolkata', 'Asia/Singapore', 'America/New_York', 'America/Toronto', 'Australia/Sydney']
}
