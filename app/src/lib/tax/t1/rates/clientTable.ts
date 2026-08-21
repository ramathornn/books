/**
 * Client-safe RateTable assembly for live (browser) compute.
 *
 * The registry `getRateTable`/`engineVersionFor` in rates/index.ts uses
 * `node:crypto` for the province hash, so it cannot be bundled into a client
 * component. The federal/AB PROFILES themselves (federal2025.ts / ab2025.ts) are
 * pure data importing only `type`s, and `computeT1` imports only round + types —
 * both are client-safe. This module composes them into a `RateTable` WITHOUT the
 * crypto-backed engineVersion, so the builder can recompute the refund/owing rail
 * instantly on every keystroke. The server `/recompute` + `/prepare` routes remain
 * the source of truth (and stamp the canonical sha256 engineVersion).
 *
 * Pure data; safe in both server and client bundles.
 */

import type { RateTable } from '@/lib/tax/t1/types'
import { FEDERAL_2025 } from '@/lib/tax/t1/rates/federal2025'
import { AB_2025 } from '@/lib/tax/t1/rates/ab2025'

const RATE_VERSION = '2025.1'

const FEDERAL_BY_YEAR: Record<number, typeof FEDERAL_2025> = { 2025: FEDERAL_2025 }
const AB_BY_YEAR: Record<number, typeof AB_2025> = { 2025: AB_2025 }

const LATEST_FED = Math.max(...Object.keys(FEDERAL_BY_YEAR).map(Number))
const LATEST_AB = Math.max(...Object.keys(AB_BY_YEAR).map(Number))

/**
 * Build a client-safe RateTable for a (taxYear, province). v1 supports Alberta;
 * any other province returns the AB table as a best-effort preview (the server
 * gate is what authoritatively blocks unsupported provinces). Falls back to the
 * latest defined year.
 */
export function clientRateTable(taxYear: number, province = 'AB'): RateTable {
  const prov = (province || 'AB').toUpperCase()
  const federal = FEDERAL_BY_YEAR[taxYear] ?? FEDERAL_BY_YEAR[LATEST_FED]
  const provincial = AB_BY_YEAR[taxYear] ?? AB_BY_YEAR[LATEST_AB]
  return {
    taxYear,
    province: prov,
    federal,
    provincial,
    rateVersion: RATE_VERSION,
  }
}
