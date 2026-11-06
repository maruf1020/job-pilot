/**
 * Region words for fixed location lists ("EMEA - Other", "APAC", "Rest of World") that do not name the
 * person's city: worked out from the country of residence, so any country gets its own region.
 */

const REGIONS: Array<{ codes: string; words: string[] }> = [
  {
    codes: 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH GB UK AL AD BA BY XK MD MC ME MK RU SM RS UA VA',
    words: ['Europe', 'EMEA', 'Rest of Europe'],
  },
  { codes: 'AE SA QA KW BH OM IL JO LB IQ IR SY YE TR EG', words: ['Middle East', 'MENA', 'EMEA'] },
  {
    codes: 'DZ MA TN LY NG GH KE ZA ET UG TZ RW SN CI CM ZM ZW BW NA MZ AO SD',
    words: ['Africa', 'EMEA', 'Sub-Saharan Africa'],
  },
  { codes: 'IN PK BD LK NP BT MV AF', words: ['South Asia', 'Asia', 'APAC'] },
  { codes: 'CN JP KR TW HK MO MN SG MY TH VN PH ID KH LA MM BN', words: ['Asia', 'APAC', 'Southeast Asia', 'East Asia'] },
  { codes: 'KZ UZ KG TJ TM AZ GE AM', words: ['Central Asia', 'Asia', 'EMEA'] },
  { codes: 'AU NZ FJ PG', words: ['Oceania', 'APAC', 'Australia and New Zealand'] },
  { codes: 'US CA', words: ['North America', 'Americas', 'AMER'] },
  {
    codes: 'MX GT HN SV NI CR PA CU DO PR JM BR AR CL CO PE VE EC BO PY UY',
    words: ['Latin America', 'LATAM', 'South America', 'Americas'],
  },
]

/** Region words for a country (ISO2), most specific first, then the catch-all entries. */
export function regionWords(countryCode: string | null | undefined): string[] {
  const c = (countryCode ?? '').trim().toUpperCase()
  const region = REGIONS.find((r) => r.codes.split(' ').includes(c))
  return [...(region?.words ?? []), 'Rest of World', 'International', 'Other']
}
