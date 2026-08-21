/**
 * T1 line descriptors + return registry (the line-keyed analogue of
 * descriptors/registry.ts, keyed by ReturnType='T1').
 *
 * Each `T1LineDescriptor` declares how one CRA line gets its value in the builder
 * (pull | manual | computed), which collapsible section it lives in, its
 * jurisdiction, optional microcopy, and whether it is opt-in (default-hidden for
 * the canonical dividend-only Alberta filer). The builder UI (ReturnFormBuilder /
 * LineField) renders directly off this array; the route/compute layers read it
 * for labels and the opt-in gating.
 *
 * Pure data/contracts only — NO I/O in this file (mirrors descriptors.ts).
 */

import type { T1LineDescriptor } from '@/lib/tax/t1/types'

/** Return types this registry serves (parallels SlipType). v1 = T1 only. */
export type ReturnType = 'T1'

/**
 * The full T1 line catalog the builder renders. Order within a section is the
 * render order. `pull` lines come from the slip pull (read-only + provenance);
 * `manual` lines are user inputs; `computed` lines are recomputed live by
 * computeT1 (read-only). Opt-in lines (capital gains / donations / medical /
 * T4A / T3) are hidden until their section toggle is enabled.
 */
export const T1_LINE_DESCRIPTORS: T1LineDescriptor[] = [
  // ----- Income -----
  {
    line: '12000',
    label: 'Taxable amount of dividends (eligible + other than eligible)',
    section: 'income',
    source: 'pull',
    jurisdiction: 'federal',
    help: 'Auto-pulled from your T5 boxes 25 + 11 (and T3, if any). Grossed-up amount — this raises your net income for credit tests.',
  },
  {
    line: '12010',
    label: 'Taxable amount of dividends other than eligible (non-eligible subset)',
    section: 'income',
    source: 'pull',
    jurisdiction: 'federal',
    help: 'Auto-pulled from T5 box 11. The non-eligible subset within line 12000.',
  },
  {
    line: '12700',
    label: 'Taxable capital gains (Schedule 3)',
    section: 'income',
    source: 'manual',
    jurisdiction: 'federal',
    optIn: true,
    help: 'Only if you hold a non-registered brokerage account. 50% inclusion. ACB is user-supplied (T5008 box 20 is often blank).',
  },
  {
    line: '13010',
    label: 'T4A income',
    section: 'income',
    source: 'pull',
    jurisdiction: 'federal',
    optIn: true,
  },
  {
    line: '13000',
    label: 'Other income',
    section: 'income',
    source: 'manual',
    jurisdiction: 'federal',
    optIn: true,
  },
  {
    line: '15000',
    label: 'Total income',
    section: 'income',
    source: 'computed',
    jurisdiction: 'federal',
  },

  // ----- Deductions -----
  {
    line: '20800',
    label: 'RRSP deduction',
    section: 'deductions',
    source: 'manual',
    jurisdiction: 'federal',
    help: 'A single number from your latest Notice of Assessment (RRSP deduction limit). Leave blank if you did not contribute.',
  },
  {
    line: '23200',
    label: 'Other deductions',
    section: 'deductions',
    source: 'manual',
    jurisdiction: 'federal',
    optIn: true,
  },
  {
    line: '23600',
    label: 'Net income',
    section: 'deductions',
    source: 'computed',
    jurisdiction: 'federal',
    help: 'Grossed-up net income. Every income-tested credit (BPA phase-out, spouse amount, age, medical) keys off this number.',
  },

  // ----- Taxable income -----
  {
    line: '26000',
    label: 'Taxable income',
    section: 'taxableIncome',
    source: 'computed',
    jurisdiction: 'federal',
  },

  // ----- Federal tax & credits -----
  {
    line: '30000',
    label: 'Basic personal amount (after phase-out)',
    section: 'federalTax',
    source: 'computed',
    jurisdiction: 'federal',
  },
  {
    line: '30300',
    label: 'Spouse or common-law partner amount',
    section: 'federalTax',
    source: 'computed',
    jurisdiction: 'federal',
    help: 'max(0, federal BPA after phase-out − spouse net income), valued at 14.5%.',
  },
  {
    line: '30100',
    label: 'Age amount',
    section: 'federalTax',
    source: 'computed',
    jurisdiction: 'federal',
  },
  {
    line: '34900',
    label: 'Donations and gifts',
    section: 'federalTax',
    source: 'manual',
    jurisdiction: 'federal',
    optIn: true,
  },
  {
    line: '40400',
    label: 'Gross federal tax',
    section: 'federalTax',
    source: 'computed',
    jurisdiction: 'federal',
  },
  {
    line: '40425',
    label: 'Federal dividend tax credit',
    section: 'federalTax',
    source: 'pull',
    jurisdiction: 'federal',
    help: 'Auto-pulled from T5 boxes 12 + 26.',
  },
  {
    line: '42000',
    label: 'Net federal tax',
    section: 'federalTax',
    source: 'computed',
    jurisdiction: 'federal',
  },

  // ----- Alberta (AB428) -----
  {
    line: '58040',
    label: 'Alberta basic personal amount',
    section: 'provincialTax',
    source: 'computed',
    jurisdiction: 'AB',
  },
  {
    line: '58120',
    label: 'Alberta spouse or common-law partner amount',
    section: 'provincialTax',
    source: 'computed',
    jurisdiction: 'AB',
    help: 'max(0, 22,323 − spouse net income), valued at 8%. Full AB BPA, no phase-out.',
  },
  {
    line: '58080',
    label: 'Alberta age amount',
    section: 'provincialTax',
    source: 'computed',
    jurisdiction: 'AB',
  },
  {
    line: '58969',
    label: 'Alberta donations and gifts',
    section: 'provincialTax',
    source: 'manual',
    jurisdiction: 'AB',
    optIn: true,
  },
  {
    line: '61520',
    label: 'Alberta dividend tax credit',
    section: 'provincialTax',
    source: 'computed',
    jurisdiction: 'AB',
    help: 'Recomputed at AB rates (8.12% eligible / 2.18% non-eligible) — never copied from the federal box.',
  },
  {
    line: '42800',
    label: 'Alberta tax',
    section: 'provincialTax',
    source: 'computed',
    jurisdiction: 'AB',
  },

  // ----- Summary -----
  {
    line: '43500',
    label: 'Total payable',
    section: 'summary',
    source: 'computed',
    jurisdiction: 'both',
  },
  {
    line: '43700',
    label: 'Total income tax deducted',
    section: 'summary',
    source: 'pull',
    jurisdiction: 'both',
    help: 'Withholding. ~$0 for a dividend-paid owner (dividends carry no tax deducted).',
  },
  {
    line: '47600',
    label: 'Tax paid by instalments (toward THIS year)',
    section: 'summary',
    source: 'manual',
    jurisdiction: 'both',
    help: 'Enter only 2025 instalments toward this year (per CRA instalment reminders). Monthly payments against a PRIOR-year balance / payment arrangement do NOT go here, and are not your company GST/corporate instalments.',
  },
  {
    line: '48400',
    label: 'Refund',
    section: 'summary',
    source: 'computed',
    jurisdiction: 'both',
  },
  {
    line: '48500',
    label: 'Balance owing',
    section: 'summary',
    source: 'computed',
    jurisdiction: 'both',
  },
]

const REGISTRY: Record<ReturnType, T1LineDescriptor[]> = {
  T1: T1_LINE_DESCRIPTORS,
}

/** Line descriptors for a return type (drives ReturnFormBuilder rendering). */
export function lineDescriptorsFor(type: ReturnType): T1LineDescriptor[] {
  return REGISTRY[type] ?? []
}

/** Look up a single descriptor by CRA line number ('T1' return). */
export function lineDescriptor(line: string): T1LineDescriptor | undefined {
  return T1_LINE_DESCRIPTORS.find((d) => d.line === line)
}
