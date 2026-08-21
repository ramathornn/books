// Parse/serialize the per-item tax list. Stored in the existing
// Item.taxes string field as JSON: [{rate, name, number}].
// Legacy format may be a plain name like "GST" — treat as 5% by default.
export interface ItemTax {
  rate: number
  name: string
  number?: string
  enabled?: boolean
}

export function parseItemTaxes(raw: string | null | undefined): ItemTax[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((t) => t && typeof t === 'object')
        .map((t) => ({
          name: String(t.name || ''),
          rate: Number(t.rate) || 0,
          number: t.number ? String(t.number) : undefined,
          enabled: t.enabled !== false,
        }))
        .filter((t) => t.name)
    }
  } catch {
    // fall through to legacy
  }
  // Legacy: single tax name string
  return [{ name: trimmed, rate: 5, enabled: true }]
}

export function serializeItemTaxes(taxes: ItemTax[]): string {
  const cleaned = taxes
    .filter((t) => t.name && t.name.trim())
    .map((t) => ({
      name: t.name.trim(),
      rate: Number(t.rate) || 0,
      number: t.number?.trim() || undefined,
      enabled: t.enabled !== false,
    }))
  return cleaned.length > 0 ? JSON.stringify(cleaned) : ''
}

export function formatTaxList(taxes: ItemTax[]): string {
  return taxes
    .filter((t) => t.enabled !== false)
    .map((t) => `${t.name} (${t.rate}%)`)
    .join(', ')
}
