import { describe, expect, it } from 'vitest'
import { boardFromUrl, dominantBoard, greenhouseBoardForJob } from './board-registry'
import { sponsorMatchKey } from './registers'

describe('boardFromUrl (URL shapes from the database)', () => {
  it.each([
    ['https://boards.eu.greenhouse.io/openup/jobs/5015968101?gh_jid=5015968101', 'greenhouse', 'openup'],
    ['https://job-boards.greenhouse.io/zonecompanysoftwareconsultingllc/jobs/5415712008', 'greenhouse', 'zonecompanysoftwareconsultingllc'],
    ['https://job-boards.eu.greenhouse.io/riverlane/jobs/5003778101', 'greenhouse', 'riverlane'],
    ['https://job-boards.greenhouse.io/celonis/jobs/7618718003?gh_jid=7618718003', 'greenhouse', 'celonis'],
    ['https://boards.greenhouse.io/embed/job_app?for=Stripe&token=123', 'greenhouse', 'stripe'],
    ['https://jobs.lever.co/zopa/a87c80d9-4a4d-4238-80e2-d3eebcb74c5a', 'lever', 'zopa'],
    ['https://jobs.lever.co/safran-ai/3477c9ec-b8f7-488f-926e-3655076da362/apply', 'lever', 'safran-ai'],
    ['https://jobs.eu.lever.co/acme/3477c9ec-b8f7-488f-926e-3655076da362', 'lever', 'acme@eu'],
    ['https://jobs.ashbyhq.com/9fin/06038f70-eddf-4b6b-8fa9-5dbf34e237d0', 'ashby', '9fin'],
    ['https://jobs.ashbyhq.com/zoe/5f2867a4-cf38-4bec-b6ca-f192a9a8736c/application', 'ashby', 'zoe'],
    ['https://riot.workable.com/jobs/5842356', 'workable', 'riot'],
    ['https://apply.workable.com/acme-ltd/j/00EC5830D3/', 'workable', 'acme-ltd'],
    ['https://jobs.smartrecruiters.com/ABOUTYOUGmbH/744000150169389-senior-fullstack-engineer', 'smartrecruiters', 'ABOUTYOUGmbH'],
    ['https://accso.recruitee.com/o/fullstack-entwickler-java', 'recruitee', 'accso'],
    ['https://360x.jobs.personio.com/job/2071228', 'personio', '360x'],
    ['https://welectron.jobs.personio.de/job/2798250?language=en', 'personio', 'welectron'],
    ['https://amssolutions.teamtailor.com/jobs/8452770-desarrollador-a-full-stack', 'teamtailor', 'amssolutions'],
    ['https://axianstechtalent.teamtailor.com/en-GB/jobs/8571391-frontend-developer', 'teamtailor', 'axianstechtalent'],
    ['https://zalando.wd3.myworkdayjobs.com/ZalandoSiteWD/job/Helsinki/Backend-Engineer_2725490', 'workday', 'zalando/ZalandoSiteWD@wd3'],
    ['https://lseg.wd3.myworkdayjobs.com/en-US/Careers/job/GBR-London/Senior-Frontend-Engineer_R0117658-1', 'workday', 'lseg/Careers@wd3'],
  ])('%s', (url, atsType, slug) => {
    expect(boardFromUrl(url)).toEqual({ atsType, slug })
  })

  it.each([
    'http://www.squarespace.com/about/careers?gh_jid=6305471',
    'https://www.wppproduction.com/careers/jobs/6234932004?gh_jid=6234932004',
    'https://apply.workable.com/j/00EC5830D3',
    'https://wd1.myworkdaysite.com/recruiting/fmr/FidelityCareers/job/Galway-Ireland/Senior_2135547-1',
    'https://teamtailor.imaginarycloud.com/jobs/8585277-senior-kotlin-back-end-developer',
    'https://www.adzuna.de/land/ad/12345',
    'not a url',
    '',
  ])('names no board: %s', (url) => {
    expect(boardFromUrl(url)).toBeNull()
  })

  it('picks the board most links point to', () => {
    expect(
      dominantBoard([
        'https://jobs.lever.co/acme/1',
        'https://job-boards.greenhouse.io/acme/jobs/2',
        'https://job-boards.greenhouse.io/acme/jobs/3',
        'https://www.adzuna.de/x',
        null,
      ]),
    ).toEqual({ atsType: 'greenhouse', slug: 'acme' })
    expect(dominantBoard(['https://www.adzuna.de/x'])).toBeNull()
  })
})

describe('greenhouseBoardForJob', () => {
  it('finds the board that owns the gh_jid job', async () => {
    const asked: string[] = []
    const f = (async (u: RequestInfo | URL) => {
      asked.push(String(u))
      return new Response('{}', { status: String(u).includes('/boards/datadog/jobs/3851927') ? 200 : 404 })
    }) as typeof fetch
    expect(await greenhouseBoardForJob('https://careers.datadoghq.com/detail/3851927/?gh_jid=3851927', 'Datadog', f)).toEqual({ atsType: 'greenhouse', slug: 'datadog' })
    expect(asked[0]).toContain('/boards/datadoghq/jobs/3851927')
  })
  it('gives up without a gh_jid or when no guess owns the job', async () => {
    const no = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    expect(await greenhouseBoardForJob('https://acme.com/careers/1', 'Acme', no)).toBeNull()
    expect(await greenhouseBoardForJob('https://acme.com/careers?gh_jid=12', 'Acme', no)).toBeNull()
  })
})

describe('sponsorMatchKey', () => {
  it('strips legal forms, group words and the local entity country', () => {
    expect(sponsorMatchKey('Intercom R&D Unlimited Company')).toBe('intercom r and d')
    expect(sponsorMatchKey('Workday Limited')).toBe('workday')
    expect(sponsorMatchKey('Stripe Technology Europe Ltd')).toBe('stripe')
    expect(sponsorMatchKey('Booking.com B.V.')).toBe('bookingcom')
    expect(sponsorMatchKey('Allegro Sp. z o.o.')).toBe('allegro')
    expect(sponsorMatchKey('Netlight Consulting AB (publ)')).toBe('netlight consulting')
    expect(sponsorMatchKey('Zalando SE')).toBe('zalando')
  })
  it('keeps short names whole', () => {
    expect(sponsorMatchKey('UK Ltd')).toBe('uk')
  })
})
