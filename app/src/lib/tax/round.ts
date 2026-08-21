/**
 * Rounding helpers for CRA tax computations.
 *
 * CRA convention is round-half-up (a.k.a. "round half away from zero" for the
 * positive amounts we deal with). The existing accounting code uses
 * `Math.round(x*100)/100`, which in JavaScript rounds half *up* for positive
 * numbers but half *toward +∞* for negatives (e.g. -0.005 → -0.00). To make the
 * intent explicit and symmetric, `round2` rounds the magnitude and re-applies
 * the sign, so -1.005 → -1.01 and 1.005 → 1.01.
 *
 * These are pure, side-effect-free, and independently unit-tested. They are the
 * single rounding source of truth for every `computeBoxes` in `compute/`.
 */

/** Round to 2 decimals, half-up (away from zero). */
export function round2(x: number): number {
  if (!Number.isFinite(x)) return 0
  const sign = x < 0 ? -1 : 1
  // Add Number.EPSILON-scaled nudge to counter binary float representation
  // error (e.g. 1.005*100 = 100.49999999999999) before flooring at .5.
  const scaled = Math.abs(x) * 100
  const rounded = Math.round(scaled + (scaled * Number.EPSILON))
  return (sign * rounded) / 100
}

/** Round to whole dollars, half-up (away from zero). */
export function roundDollar(x: number): number {
  if (!Number.isFinite(x)) return 0
  const sign = x < 0 ? -1 : 1
  const v = Math.abs(x)
  return sign * Math.round(v + v * Number.EPSILON)
}

/** Format a number as a fixed-2 string ("164450.00") for XML / slip emission. */
export function money2(x: number): string {
  return round2(x).toFixed(2)
}
