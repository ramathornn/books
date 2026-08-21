// Pure GST34 line definitions — NO server-only imports, so client components
// (e.g. the Sales Tax UI) can import GST34_LINES without dragging the compute
// module (Prisma / node: built-ins) into the browser bundle.

export interface Gst34LineDescriptor {
  key: string
  officialNumber: string
  label: string
  /** surfaced on the read-only NETFILE entry-helper screen (copy-to-clipboard). */
  netfileHelper: boolean
  /** computed from other lines rather than a raw source. */
  derived?: boolean
}

export const GST34_LINES: Gst34LineDescriptor[] = [
  { key: 'line101', officialNumber: '101', label: 'Sales and other revenue', netfileHelper: true },
  { key: 'line103', officialNumber: '103', label: 'GST/HST collected or collectible', netfileHelper: true },
  { key: 'line104', officialNumber: '104', label: 'Adjustments to be added to net tax', netfileHelper: true },
  { key: 'line105', officialNumber: '105', label: 'Total GST/HST and adjustments', netfileHelper: false, derived: true },
  { key: 'line106', officialNumber: '106', label: 'Input tax credits (ITCs)', netfileHelper: true },
  { key: 'line107', officialNumber: '107', label: 'Adjustments to be deducted from net tax', netfileHelper: true },
  { key: 'line108', officialNumber: '108', label: 'Total ITCs and adjustments', netfileHelper: false, derived: true },
  { key: 'line109', officialNumber: '109', label: 'Net tax', netfileHelper: true, derived: true },
]
