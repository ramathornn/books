/**
 * T2 rate-table registry: resolve the federal + Alberta corporate rate profiles
 * for a taxation year, mirroring the year-keyed pattern in '@/lib/tax/t1/rates'.
 *
 *  - Default + only supported province is Alberta ('AB'). Anything else is
 *    UNSUPPORTED in v1 (the verify gate raises PROVINCE_UNSUPPORTED); the caller
 *    should check `isSupportedProvince` first.
 *  - Unknown years fall back to the latest defined year per jurisdiction.
 *  - The AccII table is year-keyed separately (rates/accii.ts) and its year is
 *    folded into engineVersion via `acciiYearFor`.
 *
 * Pure data + lookups; no I/O.
 */

import crypto from 'node:crypto'

import { FEDERAL_T2_2025, type FederalT2Rates } from '@/lib/tax/t2/rates/federal2025'
import { AB_T2_2025, type AlbertaT2Rates } from '@/lib/tax/t2/rates/ab2025'
import { ACCII_TABLE_YEAR } from '@/lib/tax/t2/rates/accii'
import { makeEngineVersion } from '@/lib/tax/t2/types'

/** Default + only supported province of the corporation in v1. */
export const DEFAULT_PROVINCE = 'AB'

/** Provinces supported in v1 (Alberta only — others file differently). */
export const SUPPORTED_PROVINCES: readonly string[] = ['AB']

/** Semantic version of the rate-table DATA (bump when any figure changes). */
export const RATE_VERSION = '2025.1'

/** A complete year's corporate rate set: federal + Alberta profiles. */
export interface T2RateTable {
  taxationYear: number
  province: string
  federal: FederalT2Rates
  alberta: AlbertaT2Rates
  rateVersion: string
}

// Federal profiles keyed by year.
const FEDERAL_BY_YEAR: Record<number, FederalT2Rates> = {
  2025: FEDERAL_T2_2025,
}

// Alberta profiles keyed by year.
const ALBERTA_BY_YEAR: Record<number, AlbertaT2Rates> = {
  2025: AB_T2_2025,
}

const LATEST_FEDERAL_YEAR = Math.max(...Object.keys(FEDERAL_BY_YEAR).map(Number))
const LATEST_ALBERTA_YEAR = Math.max(...Object.keys(ALBERTA_BY_YEAR).map(Number))

/** True when the province is supported in v1 (Alberta only). */
export function isSupportedProvince(province: string): boolean {
  return SUPPORTED_PROVINCES.includes((province || '').toUpperCase())
}

/** Short, stable hash of the federal profile (rateVersion). */
function fedHash(year: number): string {
  const fed = FEDERAL_BY_YEAR[year] ?? FEDERAL_BY_YEAR[LATEST_FEDERAL_YEAR]
  return crypto
    .createHash('sha256')
    .update(`fed:${fed.rateVersion}:${fed.taxYear}`, 'utf8')
    .digest('hex')
    .slice(0, 8)
}

/** Short, stable hash of the Alberta profile (rateVersion). */
function abHash(year: number): string {
  const ab = ALBERTA_BY_YEAR[year] ?? ALBERTA_BY_YEAR[LATEST_ALBERTA_YEAR]
  return crypto
    .createHash('sha256')
    .update(`ab:${ab.rateVersion}:${ab.taxYear}`, 'utf8')
    .digest('hex')
    .slice(0, 8)
}

/**
 * The AccII table year used for a taxation year. v1 ships a single AccII table
 * (ACCII_TABLE_YEAR); the `taxationYear` arg is kept for the year-keyed contract
 * downstream agents call against and to allow future per-year tables.
 */
export function acciiYearFor(taxationYear: number): number {
  void taxationYear
  return ACCII_TABLE_YEAR
}

/**
 * Resolve the corporate rate table for a taxation year (+ province). Falls back
 * to the latest defined year per jurisdiction. The caller should check
 * `isSupportedProvince` first; for v1 only Alberta is supported.
 */
export function getRateTable(taxationYear: number, province: string = DEFAULT_PROVINCE): T2RateTable {
  const prov = (province || DEFAULT_PROVINCE).toUpperCase()
  const federal = FEDERAL_BY_YEAR[taxationYear] ?? FEDERAL_BY_YEAR[LATEST_FEDERAL_YEAR]
  const alberta = ALBERTA_BY_YEAR[taxationYear] ?? ALBERTA_BY_YEAR[LATEST_ALBERTA_YEAR]
  return {
    taxationYear,
    province: prov,
    federal,
    alberta,
    rateVersion: RATE_VERSION,
  }
}

/** Build the engineVersion string for a taxation year (folds AccII table year). */
export function engineVersionFor(taxationYear: number): string {
  return makeEngineVersion(taxationYear, fedHash(taxationYear), abHash(taxationYear), acciiYearFor(taxationYear))
}
