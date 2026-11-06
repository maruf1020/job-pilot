import { describe, expect, it } from 'vitest'
import { landingCompanyFromUrl } from './landingjobs'
import { parseLinkedInCards, parseLinkedInPosting } from './linkedin'

const CARDS = `<ul>
<li><div class="base-card" data-entity-urn="urn:li:jobPosting:4460720768">
  <a class="base-card__full-link" href="https://ie.linkedin.com/jobs/view/software-engineer-at-acme-4460720768?refId=x">Software Engineer</a>
  <h3 class="base-search-card__title">
        Software Engineer &amp; Team Lead
      </h3>
  <h4 class="base-search-card__subtitle"><a class="hidden-nested-link" href="https://ie.linkedin.com/company/acme">Acme Ltd</a></h4>
  <span class="job-search-card__location">Dublin, County Dublin, Ireland</span>
  <time class="job-search-card__listdate" datetime="2026-09-25">1 week ago</time>
</div></li>
<li><div class="base-card" data-entity-urn="urn:li:jobPosting:4470913476">
  <h3 class="base-search-card__title">Backend Developer (Remote)</h3>
  <h4 class="base-search-card__subtitle">Beta GmbH</h4>
  <span class="job-search-card__location">Berlin, Germany</span>
</div></li>
<li><div class="base-card">no urn here</div></li>
</ul>`

const POSTING = `<html><body>
<section class="show-more-less-html"><div class="show-more-less-html__markup description__text">
<p>We build <strong>payments</strong> software.</p><ul><li>Node.js and TypeScript</li><li>AWS Lambda</li></ul>
<p>We sponsor visas for the right candidate.</p></div></section>
<ul class="description__job-criteria-list">
  <li><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">Mid-Senior level</span></li>
  <li><h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">Full-time</span></li>
</ul></body></html>`

describe('LinkedIn public pages', () => {
  it('parses job cards with id, title, company, location and date', () => {
    const cards = parseLinkedInCards(CARDS)
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ id: '4460720768', title: 'Software Engineer & Team Lead', company: 'Acme Ltd', location: 'Dublin, County Dublin, Ireland', url: 'https://www.linkedin.com/jobs/view/4460720768' })
    expect(cards[0].postedAt?.toISOString()).toBe('2026-09-25T00:00:00.000Z')
    expect(cards[1]).toMatchObject({ id: '4470913476', company: 'Beta GmbH', location: 'Berlin, Germany' })
    expect(cards[1].postedAt).toBeUndefined()
  })

  it('parses the posting description and criteria', () => {
    const p = parseLinkedInPosting(POSTING)
    expect(p.description).toContain('We build payments software.')
    expect(p.description).toContain('Node.js and TypeScript')
    expect(p.description).toContain('We sponsor visas')
    expect(p.criteria).toEqual(['Mid-Senior level', 'Full-time'])
  })
})

describe('Landing.jobs', () => {
  it('derives the company name from the posting URL', () => {
    expect(landingCompanyFromUrl('https://landing.jobs/at/inscale/senior-java-software-developer-in-lisbon-2025')).toBe('Inscale')
    expect(landingCompanyFromUrl('https://landing.jobs/at/big-data-co/x')).toBe('Big Data Co')
    expect(landingCompanyFromUrl('https://landing.jobs/jobs/1')).toBe('Unknown company')
  })
})
