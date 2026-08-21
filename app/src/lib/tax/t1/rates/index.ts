/**
 * T1 rate-table registry: resolve the federal + provincial profiles for a
 * (taxYear, province) pair, mirroring the year-keyed pattern in
 * '@/lib/tax/rates' (dividendRates/accIiFactors).
 *
 *  - Default province is Alberta ('AB').
 *  - Quebec ('QC') is UNSUPPORTED in v1 (files a separate provincial return) —
 *    its profile carries `unsupported:true` and the verify gate errors on it.
 *  - Unknown years fall back to the latest defined year for that jurisdiction.
 *
 * Pure data + lookups; no I/O.
 */

import crypto from 'node:crypto'

import type { ProvinceTaxProfile, RateTable } from '@/lib/tax/t1/types'
import { makeEngineVersion } from '@/lib/tax/t1/types'
import { FEDERAL_2025 } from '@/lib/tax/t1/rates/federal2025'
import { AB_2025 } from '@/lib/tax/t1/rates/ab2025'

/** Default province of residence for v1. */
export const DEFAULT_PROVINCE = 'AB'

/** Province codes that are explicitly out of scope in v1. */
export const UNSUPPORTED_PROVINCES: readonly string[] = ['QC']

/** Semantic version of the rate-table DATA (bump when any figure changes). */
const RATE_VERSION = '2025.1'

// Federal profiles keyed by year.
const FEDERAL_BY_YEAR: Record<number, ProvinceTaxProfile> = {
  2025: FEDERAL_2025,
}

// Provincial profiles keyed by province then year.
const PROVINCIAL_BY_PROVINCE_YEAR: Record<string, Record<number, ProvinceTaxProfile>> = {
  AB: { 2025: AB_2025 },
}

const LATEST_FEDERAL_YEAR = Math.max(...Object.keys(FEDERAL_BY_YEAR).map(Number))

function latestYearFor(map: Record<number, ProvinceTaxProfile>): number {
  return Math.max(...Object.keys(map).map(Number))
}

/** True when the province is supported in v1. */
export function isSupportedProvince(province: string): boolean {
  const p = (province || '').toUpperCase()
  return !UNSUPPORTED_PROVINCES.includes(p) && !!PROVINCIAL_BY_PROVINCE_YEAR[p]
}

/** Short, stable hash of a province profile (rateVersion + jurisdiction). */
function provHash(province: string): string {
  return crypto
    .createHash('sha256')
    .update(`${RATE_VERSION}:${province}`, 'utf8')
    .digest('hex')
    .slice(0, 8)
}

/**
 * Resolve the rate table for a (taxYear, province). Falls back to the latest
 * defined year per jurisdiction. For an unsupported province the returned
 * `provincial` profile carries `unsupported:true` (a Quebec stub) so the verify
 * gate can error cleanly; the caller should check `isSupportedProvince` first.
 */
export function getRateTable(taxYear: number, province: string = DEFAULT_PROVINCE): RateTable {
  const prov = (province || DEFAULT_PROVINCE).toUpperCase()

  const federal = FEDERAL_BY_YEAR[taxYear] ?? FEDERAL_BY_YEAR[LATEST_FEDERAL_YEAR]

  const provMap = PROVINCIAL_BY_PROVINCE_YEAR[prov]
  let provincial: ProvinceTaxProfile
  if (!provMap) {
    // Unsupported (e.g. QC): synthesize a minimal unsupported stub.
    provincial = {
      jurisdiction: prov,
      taxYear,
      brackets: [],
      bpa: { max: 0, min: 0, phaseOut: null },
      creditRate: 0,
      dtc: { eligible: 0, nonEligible: 0 },
      donationTiers: { firstTierCap: 200, firstRate: 0, remainderRate: 0, topRate: null, topThreshold: null },
      spouseAmount: { base: null },
      ageAmount: { max: 0, clawbackStart: 0, rate: 0, qualifyingAge: 65 },
      medical: { fixedFloor: 0, rate: 0 },
      surtax: null,
      unsupported: true,
    }
  } else {
    provincial = provMap[taxYear] ?? provMap[latestYearFor(provMap)]
  }

  return {
    taxYear,
    province: prov,
    federal,
    provincial,
    rateVersion: RATE_VERSION,
  }
}

/** Build the engineVersion string for a (taxYear, province) rate table. */
export function engineVersionFor(taxYear: number, province: string = DEFAULT_PROVINCE): string {
  const prov = (province || DEFAULT_PROVINCE).toUpperCase()
  return makeEngineVersion(taxYear, provHash(prov))
}
