import { describe, expect, it } from 'vitest'
import { sameCompanyKey } from './same-company'

describe('sameCompanyKey', () => {
  it('sees one company under different spellings (CHAOS Industries got two applications in 4 days)', () => {
    expect(sameCompanyKey('CHAOS Industries')).toBe(sameCompanyKey('Chaosindustries'))
    expect(sameCompanyKey('IT House - Global Business Solutions')).toBe(sameCompanyKey('IT House Global Business Solutions'))
    expect(sameCompanyKey('instabee.teamtailor.com')).toBe(sameCompanyKey('Instabee AB'))
  })

  it('keeps different companies apart', () => {
    expect(sameCompanyKey('PIXID')).not.toBe(sameCompanyKey('Pixida Group'))
    expect(sameCompanyKey('Autodesk')).not.toBe(sameCompanyKey('Adtran'))
  })
})
