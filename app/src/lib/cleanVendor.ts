/**
 * Post-OCR vendor sanitiser (pure). OCR emits a `vendor` from whatever text is
 * most prominent, which on a forwarded receipt is often the shared-mailbox /
 * workspace chrome ("ACME Mail", a Gmail header), your own org name, a bare email
 * address, or a doc-type word ("Transaction Invoice"). Any of those becomes a
 * wrong filename + a junk Vendor row. Sanitise here, AFTER OCR, so the OCR call
 * stays untouched. On rejection return null and the caller leaves the vendor
 * blank — better unlabeled than mislabeled.
 */

export interface CleanVendorOpts {
  /** Your own organisation names/aliases — config (CompanySettings + env), not hardcoded. */
  ownOrgNames?: string[]
}

/** Mailbox / workspace / notification chrome that is never a merchant. */
const CHROME = /\bg?mail\b|\bworkspace\b|\binbox\b|\bmailer-daemon\b|no-?reply|\bnotifications?\b/i

/** Words that, on their own, name a document type rather than a merchant. */
const DOC_TYPE = new Set([
  'invoice',
  'receipt',
  'transaction',
  'order',
  'confirmation',
  'statement',
  'bill',
  'payment',
  'paid',
])

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function cleanVendor(raw: string | null | undefined, opts: CleanVendorOpts): string | null {
  const v = (raw || '').replace(/\s+/g, ' ').trim()
  if (!v) return null

  // Bare email address (e.g. "billing@vendor.com").
  if (/\S+@\S+\.\S+/.test(v)) return null

  // Mailbox / workspace / notification chrome.
  if (CHROME.test(v)) return null

  // Doc-type-only string (every token is a document-type word).
  const tokens = v.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.length > 0 && tokens.every((t) => DOC_TYPE.has(t))) return null

  // Your own org name / alias (inclusion either way on the normalised form).
  const nv = norm(v)
  for (const org of opts.ownOrgNames ?? []) {
    const no = norm(org)
    if (no.length >= 3 && (nv === no || nv.includes(no) || no.includes(nv))) return null
  }

  return v
}
