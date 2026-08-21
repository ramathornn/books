/**
 * Client-safe T2 rate-profile accessors for live (browser) compute.
 *
 * The registry `getRateTable`/`engineVersionFor` in rates/index.ts uses
 * `node:crypto` for the rate hashes, so it cannot be bundled into a client
 * component. The federal/AB PROFILES (federal2025.ts / ab2025.ts) are pure data
 * importing only `type`s, and `computeT2Federal`/`computeAt1` import only round +
 * types — all client-safe. This module exposes the profiles WITHOUT the
 * crypto-backed engineVersion so the builder can recompute the federal Part I +
 * Alberta tax rail instantly on every keystroke. The server /recompute + /prepare
 * routes remain the source of truth (and stamp the canonical engineVersion).
 *
 * Pure data; safe in both server and client bundles.
 */

import { FEDERAL_T2_2025, type FederalT2Rates } from '@/lib/tax/t2/rates/federal2025'
import { AB_T2_2025, type AlbertaT2Rates } from '@/lib/tax/t2/rates/ab2025'

const FEDERAL_BY_YEAR: Record<number, FederalT2Rates> = { 2025: FEDERAL_T2_2025 }
const ALBERTA_BY_YEAR: Record<number, AlbertaT2Rates> = { 2025: AB_T2_2025 }

const LATEST_FED = Math.max(...Object.keys(FEDERAL_BY_YEAR).map(Number))
const LATEST_AB = Math.max(...Object.keys(ALBERTA_BY_YEAR).map(Number))

/** Client-safe federal rate profile for a taxation year (latest-year fallback). */
export function clientFederalRates(taxationYear: number): FederalT2Rates {
  return FEDERAL_BY_YEAR[taxationYear] ?? FEDERAL_BY_YEAR[LATEST_FED]
}

/** Client-safe Alberta rate profile for a taxation year (latest-year fallback). */
export function clientAlbertaRates(taxationYear: number): AlbertaT2Rates {
  return ALBERTA_BY_YEAR[taxationYear] ?? ALBERTA_BY_YEAR[LATEST_AB]
}

/** A non-crypto engine-version sentinel for the client preview (server stamps the real one). */
export const CLIENT_ENGINE_VERSION = 'client-preview'
