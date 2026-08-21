import { computeGst34, computeGst34Lines } from '@/lib/tax/compute/gst34'
import { round2 } from '@/lib/tax/round'
import { GST34_LINES, type Gst34LineDescriptor } from '@/lib/tax/descriptors/gst34Lines'

// Re-export the pure line definitions so existing server-side importers of
// '@/lib/tax/descriptors/gst34' keep working unchanged. Client components must
// import from '@/lib/tax/descriptors/gst34Lines' directly (no compute import).
export { GST34_LINES }
export type { Gst34LineDescriptor }

/**
 * GST34 line descriptor. Maps each GST/HST return line to its official line
 * number and the NETFILE entry-helper label. There is no transmit file and no
 * AcroForm fill for GST34 (design finding #10) — output is a printable
 * worksheet PDF + a copy-to-clipboard NETFILE helper — so descriptors carry
 * `netfileHelper` (whether the line is keyed into CRA NETFILE) instead of an
 * AcroForm field.
 */

export const GST34_DESCRIPTOR = {
  type: 'GST34' as const,
  lines: GST34_LINES,
  computeLines: computeGst34Lines,
  compute: computeGst34,
  round: round2,
}

export type Gst34Descriptor = typeof GST34_DESCRIPTOR
