/**
 * Client-safe Luhn + SIN/BN helpers for the tax recipient forms.
 *
 * `@/lib/tax/sin` imports `node:crypto` at module scope (AES-GCM), so it cannot
 * be bundled into a client component. These pure mirrors of `normalizeSin` /
 * `luhnValid` / `isValidSin` give SinBnInput live validation without pulling
 * crypto into the browser. The server route still re-validates with the canonical
 * `@/lib/tax/sin` before persisting.
 */

export function normalizeDigits(raw: string): string {
  return (raw || '').replace(/\D/g, '')
}

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

/** 9-digit SIN that passes Luhn. */
export function isValidSinClient(raw: string): boolean {
  const d = normalizeDigits(raw)
  return d.length === 9 && luhnValid(d)
}

/**
 * Loose CRA Business Number check: 9-digit BN (optionally followed by a 2-letter
 * program identifier + 4-digit reference, e.g. 123456789RZ0001). We validate the
 * 9-digit registration number for length only (CRA BNs are not Luhn-checked the
 * same way; the 9th digit is a check digit but the algorithm differs by era), so
 * this just enforces shape.
 */
export function isPlausibleBn(raw: string): boolean {
  const compact = (raw || '').replace(/\s/g, '').toUpperCase()
  return /^\d{9}([A-Z]{2}\d{4})?$/.test(compact)
}

export function maskSinLast3(raw: string): string {
  const last3 = normalizeDigits(raw).slice(-3)
  return last3 ? `•••-••-${last3}` : ''
}
