/**
 * Shift a date range back by one calendar year.
 * Used by report "vs Last Year" view modes so prior-period comparisons line up
 * on the same month/day as the current period.
 *
 * Shifted with the UTC setters: range boundaries are UTC calendar-date
 * instants (see `lib/reportRange.ts`), and a local-time shift could drift an
 * hour across a DST edge and land the boundary in the next UTC day.
 */
export function priorYearRange(range: { start: Date; end: Date }): { start: Date; end: Date } {
  const shift = (d: Date) => {
    const n = new Date(d)
    n.setUTCFullYear(n.getUTCFullYear() - 1)
    return n
  }
  return { start: shift(range.start), end: shift(range.end) }
}
