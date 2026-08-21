// Helpers for advancing nextRunDate on a RecurringTemplate.

export type IntervalUnit = 'day' | 'week' | 'month' | 'quarter' | 'year'

export function advanceDate(from: Date, unit: IntervalUnit, count: number): Date {
  const d = new Date(from.getTime())
  switch (unit) {
    case 'day': d.setDate(d.getDate() + count); break
    case 'week': d.setDate(d.getDate() + count * 7); break
    case 'month': d.setMonth(d.getMonth() + count); break
    case 'quarter': d.setMonth(d.getMonth() + count * 3); break
    case 'year': d.setFullYear(d.getFullYear() + count); break
  }
  return d
}

export function describeInterval(unit: IntervalUnit, count: number): string {
  if (count === 1) {
    switch (unit) {
      case 'day': return 'Daily'
      case 'week': return 'Weekly'
      case 'month': return 'Monthly'
      case 'quarter': return 'Quarterly'
      case 'year': return 'Yearly'
    }
  }
  return `Every ${count} ${unit}${count > 1 ? 's' : ''}`
}
