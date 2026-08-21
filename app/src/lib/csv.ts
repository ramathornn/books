/**
 * Minimal CSV utilities — keep dep-free.
 *
 * `escapeCsvField` quotes every field and doubles internal quotes, per
 * RFC 4180 with a generous "always-quote" policy for safety.
 *
 * `formatCsv` joins headers + rows with CRLF line endings (Excel-friendly).
 */

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '""'
  const s = String(value)
  return `"${s.replace(/"/g, '""')}"`
}

export function formatCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvField).join(',')]
  for (const r of rows) {
    lines.push(r.map(escapeCsvField).join(','))
  }
  return lines.join('\r\n')
}

/**
 * Low-level CSV parse into a header row + positional data rows (2D array).
 * Handles quoted fields with embedded commas, embedded newlines, escaped
 * quotes (""), and \r\n / \n line endings. Header row is the first non-empty
 * line. All fields are trimmed. Completely-empty rows are dropped.
 *
 * This is the single source of truth for CSV parsing — `parseCsv` (object
 * form) is built on top of it, and the bank-import wizard consumes the
 * positional rows directly for column-by-index mapping.
 */
export function parseCsvRows(text: string): {
  headers: string[]
  rows: string[][]
} {
  const records: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      cur.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      // swallow - newline handler below will commit row
      i++
      continue
    }
    if (ch === '\n') {
      cur.push(field)
      records.push(cur)
      cur = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }

  // commit any trailing field/row
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    records.push(cur)
  }

  // trim every field, then drop completely-empty rows
  const trimmed = records.map((r) => r.map((f) => f.trim()))
  const nonEmpty = trimmed.filter(
    (r) => !(r.length === 1 && r[0] === '')
  )
  if (nonEmpty.length === 0) return { headers: [], rows: [] }

  return { headers: nonEmpty[0], rows: nonEmpty.slice(1) }
}

/**
 * Parse a CSV text into header + array-of-objects (values keyed by header).
 * Built on `parseCsvRows`. Header row is the first non-empty line.
 *
 * Returns { headers: string[], rows: Record<string,string>[] }.
 */
export function parseCsv(text: string): {
  headers: string[]
  rows: Record<string, string>[]
} {
  const { headers, rows: rawRows } = parseCsvRows(text)
  if (headers.length === 0) return { headers: [], rows: [] }

  const rows: Record<string, string>[] = []
  for (const raw of rawRows) {
    const obj: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = raw[c] ?? ''
    }
    rows.push(obj)
  }
  return { headers, rows }
}

/**
 * Case-insensitive header matcher: returns the first key in `obj` whose
 * lowercased name matches one of `aliases` (also lowercased).
 */
export function pickField(
  obj: Record<string, string>,
  aliases: string[]
): string {
  const lowerMap = new Map<string, string>()
  for (const k of Object.keys(obj)) {
    lowerMap.set(k.toLowerCase().trim(), obj[k])
  }
  for (const a of aliases) {
    const v = lowerMap.get(a.toLowerCase().trim())
    if (v !== undefined) return v
  }
  return ''
}

/**
 * Format a Date as YYYY-MM-DD in UTC (Excel-friendly).
 */
export function formatCsvDate(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}
