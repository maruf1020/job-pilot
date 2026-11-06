import { EUROPE_COUNTRIES } from '@/lib/domain'

const COUNTRY_ALIASES: Record<string, string> = {
  ireland: 'IE',
  'republic of ireland': 'IE',
  éire: 'IE',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  germany: 'DE',
  deutschland: 'DE',
  netherlands: 'NL',
  'the netherlands': 'NL',
  holland: 'NL',
  nederland: 'NL',
  sweden: 'SE',
  sverige: 'SE',
  denmark: 'DK',
  danmark: 'DK',
  finland: 'FI',
  suomi: 'FI',
  norway: 'NO',
  norge: 'NO',
  portugal: 'PT',
  spain: 'ES',
  españa: 'ES',
  france: 'FR',
  belgium: 'BE',
  belgië: 'BE',
  belgique: 'BE',
  luxembourg: 'LU',
  austria: 'AT',
  österreich: 'AT',
  switzerland: 'CH',
  schweiz: 'CH',
  suisse: 'CH',
  italy: 'IT',
  italia: 'IT',
  poland: 'PL',
  polska: 'PL',
  'czech republic': 'CZ',
  czechia: 'CZ',
  estonia: 'EE',
  eesti: 'EE',
  latvia: 'LV',
  lithuania: 'LT',
  hungary: 'HU',
  romania: 'RO',
  bulgaria: 'BG',
  croatia: 'HR',
  slovenia: 'SI',
  slovakia: 'SK',
  greece: 'GR',
  cyprus: 'CY',
  malta: 'MT',
  iceland: 'IS',
}

const CITY_TO_COUNTRY: Record<string, string> = {
  dublin: 'IE',
  cork: 'IE',
  galway: 'IE',
  limerick: 'IE',
  waterford: 'IE',
  london: 'GB',
  manchester: 'GB',
  edinburgh: 'GB',
  glasgow: 'GB',
  birmingham: 'GB',
  bristol: 'GB',
  cambridge: 'GB',
  leeds: 'GB',
  belfast: 'GB',
  berlin: 'DE',
  munich: 'DE',
  münchen: 'DE',
  hamburg: 'DE',
  frankfurt: 'DE',
  cologne: 'DE',
  köln: 'DE',
  stuttgart: 'DE',
  düsseldorf: 'DE',
  dusseldorf: 'DE',
  leipzig: 'DE',
  karlsruhe: 'DE',
  nuremberg: 'DE',
  nürnberg: 'DE',
  heidelberg: 'DE',
  amsterdam: 'NL',
  rotterdam: 'NL',
  utrecht: 'NL',
  eindhoven: 'NL',
  'the hague': 'NL',
  'den haag': 'NL',
  stockholm: 'SE',
  gothenburg: 'SE',
  göteborg: 'SE',
  malmö: 'SE',
  malmo: 'SE',
  copenhagen: 'DK',
  københavn: 'DK',
  aarhus: 'DK',
  helsinki: 'FI',
  tampere: 'FI',
  espoo: 'FI',
  oslo: 'NO',
  bergen: 'NO',
  lisbon: 'PT',
  lisboa: 'PT',
  porto: 'PT',
  braga: 'PT',
  madrid: 'ES',
  barcelona: 'ES',
  valencia: 'ES',
  malaga: 'ES',
  málaga: 'ES',
  paris: 'FR',
  lyon: 'FR',
  toulouse: 'FR',
  nantes: 'FR',
  brussels: 'BE',
  bruxelles: 'BE',
  antwerp: 'BE',
  ghent: 'BE',
  gent: 'BE',
  vienna: 'AT',
  wien: 'AT',
  graz: 'AT',
  zurich: 'CH',
  zürich: 'CH',
  geneva: 'CH',
  basel: 'CH',
  bern: 'CH',
  lausanne: 'CH',
  milan: 'IT',
  milano: 'IT',
  rome: 'IT',
  roma: 'IT',
  turin: 'IT',
  torino: 'IT',
  warsaw: 'PL',
  warszawa: 'PL',
  krakow: 'PL',
  kraków: 'PL',
  wroclaw: 'PL',
  wrocław: 'PL',
  gdansk: 'PL',
  gdańsk: 'PL',
  poznan: 'PL',
  poznań: 'PL',
  prague: 'CZ',
  praha: 'CZ',
  brno: 'CZ',
  tallinn: 'EE',
  tartu: 'EE',
  riga: 'LV',
  vilnius: 'LT',
  kaunas: 'LT',
  budapest: 'HU',
  bucharest: 'RO',
  bucurești: 'RO',
  cluj: 'RO',
  'cluj-napoca': 'RO',
  sofia: 'BG',
  zagreb: 'HR',
  ljubljana: 'SI',
  bratislava: 'SK',
  athens: 'GR',
  nicosia: 'CY',
  limassol: 'CY',
  valletta: 'MT',
  reykjavik: 'IS',
}

const REMOTE_RE = /\b(remote|work from home|wfh|home[- ]based|fully distributed|anywhere)\b/i

export function isRemoteLocation(location?: string | null, extra?: string | null): boolean {
  return REMOTE_RE.test(location ?? '') || REMOTE_RE.test(extra ?? '')
}

/** Countries outside Europe the app can be switched on for (Settings → Search), by name. */
const OTHER_COUNTRY_ALIASES: Record<string, string> = {
  canada: 'CA',
  australia: 'AU',
  'new zealand': 'NZ',
  aotearoa: 'NZ',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
}

/** Provinces, states and cities of those countries. */
const OTHER_PLACES: Record<string, string> = {
  ontario: 'CA', 'british columbia': 'CA', quebec: 'CA', québec: 'CA', alberta: 'CA', 'nova scotia': 'CA', manitoba: 'CA', saskatchewan: 'CA', 'new brunswick': 'CA',
  toronto: 'CA', vancouver: 'CA', montreal: 'CA', montréal: 'CA', ottawa: 'CA', calgary: 'CA', edmonton: 'CA', waterloo: 'CA', kitchener: 'CA', winnipeg: 'CA', halifax: 'CA', mississauga: 'CA',
  'new south wales': 'AU', queensland: 'AU', 'western australia': 'AU', 'south australia': 'AU', tasmania: 'AU',
  sydney: 'AU', melbourne: 'AU', brisbane: 'AU', perth: 'AU', adelaide: 'AU', canberra: 'AU', hobart: 'AU', 'gold coast': 'AU',
  auckland: 'NZ', wellington: 'NZ', christchurch: 'NZ',
  california: 'US', texas: 'US', florida: 'US', illinois: 'US', massachusetts: 'US', colorado: 'US', pennsylvania: 'US', 'north carolina': 'US', ohio: 'US', michigan: 'US',
  minnesota: 'US', oregon: 'US', arizona: 'US', utah: 'US', 'new jersey': 'US', virginia: 'US', tennessee: 'US', 'new york': 'US', nyc: 'US',
  'san francisco': 'US', 'bay area': 'US', 'palo alto': 'US', 'mountain view': 'US', 'san jose': 'US', 'los angeles': 'US', 'san diego': 'US', seattle: 'US', boston: 'US',
  austin: 'US', chicago: 'US', denver: 'US', atlanta: 'US', miami: 'US', dallas: 'US', houston: 'US', phoenix: 'US', philadelphia: 'US', minneapolis: 'US',
  'salt lake city': 'US', raleigh: 'US', nashville: 'US', pittsburgh: 'US', detroit: 'US', 'washington, dc': 'US', 'washington dc': 'US', brooklyn: 'US', 'menlo park': 'US', sunnyvale: 'US',
}

/** "New South Wales" is not Wales, "New England" is not England, "New Mexico" is not Mexico. */
const MISLEADING_PLACES_RE = /\bnew (south wales|england|mexico|jersey|york)\b/g

/** US state abbreviations after a comma ("Austin, TX"), the usual way American postings write locations. */
const US_STATE_RE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b(\s|$|,|\))/

/**
 * Best-effort country from a free-text location ("Dublin, Ireland", "Berlin (Hybrid)",
 * "Remote - Germany", "DE", "Amsterdam", "Austin, TX", "Toronto, ON"). Europe is checked first,
 * so a posting listing "Dublin or New York" counts as Ireland. Returns ISO alpha-2 or the fallback.
 */
export function guessCountry(location?: string | null, fallback?: string): string | undefined {
  if (!location) return fallback
  const raw = location.trim()
  if (!raw) return fallback
  return europeanCountry(raw) ?? otherCountry(raw) ?? fallback
}

function europeanCountry(raw: string): string | undefined {
  // ISO code tokens like "IE", "DE" (uppercase in the original text)
  const isoTokens = raw.match(/\b[A-Z]{2}\b/g) ?? []
  for (const t of isoTokens) if (t in EUROPE_COUNTRIES) return t
  if (/\bUK\b/.test(raw)) return 'GB'

  const lower = raw.toLowerCase().replace(MISLEADING_PLACES_RE, ' ')
  const parts = lower
    .split(/[,;|/()\[\]–—-]+/)
    .map((p) => p.trim())
    .filter(Boolean)

  // Country names first (whole part or contained)
  for (const p of [...parts].reverse()) {
    if (COUNTRY_ALIASES[p]) return COUNTRY_ALIASES[p]
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    if (new RegExp(`\\b${escapeRegex(alias)}\\b`).test(lower)) return code
  }
  // "Cambridge, MA" and "Birmingham, AL" are American before they are British.
  if (US_STATE_RE.test(raw)) return undefined
  // "Rome, New York, United States" is American: a named non-European country beats a European city name
  // (Northrop Grumman's Rome, NY posting was tagged Italy and once reached the form agents).
  if (parts.some((p) => OTHER_COUNTRY_ALIASES[p])) return undefined

  // Then cities
  for (const p of parts) {
    if (CITY_TO_COUNTRY[p]) return CITY_TO_COUNTRY[p]
  }
  for (const [city, code] of Object.entries(CITY_TO_COUNTRY)) {
    if (new RegExp(`\\b${escapeRegex(city)}\\b`).test(lower)) return code
  }
  return undefined
}

/** Canada, Australia, New Zealand or the USA, from names, provinces, states, cities or codes. */
function otherCountry(raw: string): string | undefined {
  if (US_STATE_RE.test(raw)) return 'US'
  const lower = raw.toLowerCase()
  const parts = lower
    .split(/[,;|/()\[\]–—-]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  for (const p of [...parts].reverse()) {
    if (OTHER_COUNTRY_ALIASES[p]) return OTHER_COUNTRY_ALIASES[p]
    if (OTHER_PLACES[p]) return OTHER_PLACES[p]
  }
  for (const [alias, code] of Object.entries(OTHER_COUNTRY_ALIASES)) {
    if (new RegExp(`(^|[^a-z])${escapeRegex(alias)}([^a-z]|$)`).test(lower)) return code
  }
  if (/\b(AUS?|Australia)\b/.test(raw)) return 'AU'
  if (/\bNZ\b/.test(raw)) return 'NZ'
  if (/\b(US|USA)\b/.test(raw)) return 'US'
  for (const [place, code] of Object.entries(OTHER_PLACES)) {
    if (new RegExp(`(^|[^a-z])${escapeRegex(place)}([^a-z]|$)`).test(lower)) return code
  }
  return undefined
}

/** Places outside Europe that show up in job locations: the gate drops these jobs. */
const OUTSIDE_EUROPE: Record<string, string> = {
  // countries and regions
  'united states': 'United States', usa: 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States', canada: 'Canada', india: 'India', australia: 'Australia',
  'new zealand': 'New Zealand', singapore: 'Singapore', brazil: 'Brazil', mexico: 'Mexico', japan: 'Japan', china: 'China', 'south korea': 'South Korea', korea: 'South Korea',
  israel: 'Israel', 'united arab emirates': 'United Arab Emirates', uae: 'United Arab Emirates', dubai: 'Dubai', 'abu dhabi': 'Abu Dhabi', 'saudi arabia': 'Saudi Arabia', qatar: 'Qatar',
  pakistan: 'Pakistan', 'sri lanka': 'Sri Lanka', nepal: 'Nepal', nigeria: 'Nigeria', kenya: 'Kenya', 'south africa': 'South Africa', egypt: 'Egypt',
  argentina: 'Argentina', colombia: 'Colombia', chile: 'Chile', peru: 'Peru', philippines: 'Philippines', indonesia: 'Indonesia', vietnam: 'Vietnam', thailand: 'Thailand',
  malaysia: 'Malaysia', 'hong kong': 'Hong Kong', taiwan: 'Taiwan', latam: 'Latin America', apac: 'Asia-Pacific', 'north america': 'North America',
  // cities
  'new york': 'New York', nyc: 'New York', 'san francisco': 'San Francisco', 'bay area': 'San Francisco Bay Area', 'palo alto': 'Palo Alto', 'mountain view': 'Mountain View',
  'san jose': 'San Jose', 'los angeles': 'Los Angeles', 'san diego': 'San Diego', seattle: 'Seattle', boston: 'Boston', austin: 'Austin', chicago: 'Chicago', denver: 'Denver',
  atlanta: 'Atlanta', miami: 'Miami', dallas: 'Dallas', houston: 'Houston', phoenix: 'Phoenix', portland: 'Portland', philadelphia: 'Philadelphia', minneapolis: 'Minneapolis',
  'salt lake city': 'Salt Lake City', raleigh: 'Raleigh', nashville: 'Nashville', pittsburgh: 'Pittsburgh', detroit: 'Detroit', orlando: 'Orlando', tampa: 'Tampa',
  'washington, dc': 'Washington DC', 'washington dc': 'Washington DC', toronto: 'Toronto', vancouver: 'Vancouver', montreal: 'Montreal', ottawa: 'Ottawa', calgary: 'Calgary',
  waterloo: 'Waterloo', bangalore: 'Bangalore', bengaluru: 'Bengaluru', hyderabad: 'Hyderabad', pune: 'Pune', mumbai: 'Mumbai', 'new delhi': 'New Delhi', delhi: 'Delhi',
  gurugram: 'Gurugram', gurgaon: 'Gurgaon', chennai: 'Chennai', noida: 'Noida', kolkata: 'Kolkata', sydney: 'Sydney', melbourne: 'Melbourne', brisbane: 'Brisbane', perth: 'Perth',
  adelaide: 'Adelaide', canberra: 'Canberra', auckland: 'Auckland', 'tel aviv': 'Tel Aviv', 'sao paulo': 'Sao Paulo', 'são paulo': 'Sao Paulo', 'mexico city': 'Mexico City',
  tokyo: 'Tokyo', seoul: 'Seoul', shanghai: 'Shanghai', beijing: 'Beijing', shenzhen: 'Shenzhen', karachi: 'Karachi', lahore: 'Lahore', cairo: 'Cairo', lagos: 'Lagos',
  nairobi: 'Nairobi', 'cape town': 'Cape Town', johannesburg: 'Johannesburg', 'buenos aires': 'Buenos Aires', bogota: 'Bogota', 'bogotá': 'Bogota', manila: 'Manila', jakarta: 'Jakarta',
  'ho chi minh': 'Ho Chi Minh City', taipei: 'Taipei', 'kuala lumpur': 'Kuala Lumpur', bangkok: 'Bangkok',
}

const OTHER_NAMES: Record<string, string> = { CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', US: 'United States' }

/**
 * The place outside Europe that a location names, or null. A location that also names a
 * European country or city (e.g. "Dublin or New York") is not treated as outside.
 */
export function outsideEurope(location?: string | null): string | null {
  if (!location?.trim()) return null
  if (europeanCountry(location.trim())) return null
  const lower = location.toLowerCase()
  for (const [alias, name] of Object.entries(OUTSIDE_EUROPE)) {
    if (new RegExp(`(^|[^a-z])${escapeRegex(alias)}([^a-z]|$)`).test(lower)) return name
  }
  const other = otherCountry(location.trim())
  if (other) return OTHER_NAMES[other] ?? other
  // Any other country outside Europe, by its English name ("Remote - Kenya", "Lima, Peru").
  for (const [alias, name] of worldCountryNames()) {
    if (new RegExp(`(^|[^a-z])${escapeRegex(alias)}([^a-z]|$)`).test(lower)) return name
  }
  return null
}

/** Territories and neighbours of Europe that the region list does not name: never "outside Europe" by name alone. */
const EUROPE_ADJACENT = new Set(['GI', 'JE', 'GG', 'IM', 'FO', 'AX', 'SJ', 'XK', 'AD', 'MC', 'SM', 'VA', 'LI', 'MD', 'UA', 'BY', 'RU', 'RS', 'BA', 'ME', 'MK', 'AL', 'TR', 'GE', 'AM', 'AZ', 'CY', 'GL'])
let worldNames: Array<[string, string]> | null = null

/** English names of every country outside Europe (from Intl), lower-cased, longest first. */
function worldCountryNames(): Array<[string, string]> {
  if (worldNames) return worldNames
  const out: Array<[string, string]> = []
  try {
    const en = new Intl.DisplayNames(['en'], { type: 'region' })
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b)
        if (code in EUROPE_COUNTRIES || EUROPE_ADJACENT.has(code)) continue
        let name: string | undefined
        try {
          name = en.of(code)
        } catch {
          continue
        }
        if (!name || name === code || /unknown|europe|eurozone|united nations|pseudo|outlying|world/i.test(name)) continue
        out.push([name.toLowerCase(), name])
      }
  } catch {
    /* no Intl region names: the hand list above still applies */
  }
  worldNames = out.sort((x, y) => y[0].length - x[0].length)
  return worldNames
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Country name → code for source adapters that take a country name (Jooble hosts etc.). */
export const JOOBLE_HOSTS: Record<string, string> = {
  IE: 'ie.jooble.org',
  GB: 'uk.jooble.org',
  DE: 'de.jooble.org',
  NL: 'nl.jooble.org',
  SE: 'se.jooble.org',
  DK: 'dk.jooble.org',
  FI: 'fi.jooble.org',
  NO: 'no.jooble.org',
  PT: 'pt.jooble.org',
  ES: 'es.jooble.org',
  FR: 'fr.jooble.org',
  BE: 'be.jooble.org',
  AT: 'at.jooble.org',
  CH: 'ch.jooble.org',
  IT: 'it.jooble.org',
  PL: 'pl.jooble.org',
  CZ: 'cz.jooble.org',
  HU: 'hu.jooble.org',
  RO: 'ro.jooble.org',
  GR: 'gr.jooble.org',
}

/** Adzuna country codes it actually serves (Ireland is not among them); CA/AU/US/NZ only when switched on in Settings → Search. */
export const ADZUNA_COUNTRIES = new Set(['GB', 'DE', 'NL', 'FR', 'AT', 'BE', 'CH', 'ES', 'IT', 'PL', 'CA', 'AU', 'US', 'NZ'])

/**
 * A country's name in English and the languages of European application forms ("Netherlands", "Niederlande",
 * "Pays-Bas"...): a SuccessFactors form once listed the country in German and the run called it not eligible.
 */
const VARIANT_LANGS = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'no', 'cs', 'ro', 'hu']
const variantCache = new Map<string, string[]>()
export function countryNameVariants(name: string): string[] {
  const key = name.trim().toLowerCase()
  if (!key) return []
  const hit = variantCache.get(key)
  if (hit) return hit
  const en = new Intl.DisplayNames(['en'], { type: 'region' })
  let code: string | undefined
  for (let a = 65; a <= 90 && !code; a++)
    for (let b = 65; b <= 90; b++) {
      const c = String.fromCharCode(a, b)
      try {
        if (en.of(c)?.toLowerCase() === key) {
          code = c
          break
        }
      } catch {
        /* not a region */
      }
    }
  const out = new Set([name.trim()])
  if (code) for (const l of VARIANT_LANGS) {
    const n = new Intl.DisplayNames([l], { type: 'region' }).of(code)
    if (n && n !== code) out.add(n)
  }
  const list = [...out]
  variantCache.set(key, list)
  return list
}
