import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import { effectiveSlipsForYear } from '@/lib/tax/effectiveSlips'
import { decryptSin, isValidSin } from '@/lib/tax/sin'
import { round2 } from '@/lib/tax/round'
import { dividendRates } from '@/lib/tax/rates'
import { serializeReturn, type SlipXmlInput, type FilerXmlInput } from '@/lib/tax/xml'
import { T5_BOXES } from '@/lib/tax/descriptors/t5'
import { T4A_BOXES } from '@/lib/tax/descriptors/t4a'

/**
 * buildFilingExport — assemble a CRA T5/T4A information-return filing from the
 * EFFECTIVE slips for a year (tail per slipNumber, cancelled excluded), so the
 * Summary page and the filing can never diverge (design finding #5).
 *
 * Pipeline (design §3, §6):
 *   1. Load effective slips + filer identity (CompanySettings).
 *   2. Regenerate the SIN-bearing XML IN MEMORY from encrypted snapshots.
 *   3. Run zod business-rule validation: filer BN/RZ present, SIN xor BN,
 *      Luhn, intra-slip arithmetic (Box11≈Box10×1.15, Box12≈Box11×0.090301 and
 *      the eligible analogues), and summary foots to Σ effective slips.
 *   4. OPTIONAL xmllint --schema XSD gate, SKIPPED-WITH-WARNING when the
 *      `xsd/` template files are absent (graceful degrade — never crashes).
 *   5. Persist ONLY checksum + validationReport + slipIds (never SIN-bearing
 *      XML). The XML is regenerated again on authorized, permission-gated
 *      download.
 *
 * Returns the validation report + the in-memory XML; the route decides whether
 * to write the FilingExport row (blocking download on `ok === false`).
 */

const KIND_BY_TYPE: Record<string, string> = { T5: 't5_return', T4A: 't4a_return' }
const XSD_DIR = path.join(process.cwd(), 'src', 'lib', 'tax', 'xsd')

export interface ValidationIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  slipId?: string
}

export interface ValidationReport {
  ok: boolean
  checkedAt: string
  type: string
  taxYear: number
  slipCount: number
  issues: ValidationIssue[]
  xsd: { ran: boolean; passed: boolean; note: string }
  summaryTotals: Record<string, number>
}

export interface BuildFilingResult {
  report: ValidationReport
  /** in-memory regenerated XML; NEVER persisted as-is. */
  xml: string
  checksum: string
  slipIds: string[]
  filerSnapshot: { legalName: string; bnRz: string; address: string }
}

interface LoadedSlip {
  id: string
  type: string
  status: string
  reportCode: string
  slipNumber: string | null
  boxes: Record<string, number>
  boxesOverride: Record<string, number> | null
  recipientNameSnapshot: string
  recipientAddressSnapshot: string
  recipientBnSnapshot: string | null
  recipientSinCipher: string | null
}

function asNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function eff(slip: LoadedSlip, key: string): number | undefined {
  const o = slip.boxesOverride?.[key]
  if (o !== null && o !== undefined) return asNum(o)
  return asNum(slip.boxes?.[key])
}

/** Box-level zod schema: every present box must be a finite non-negative number. */
const boxSchema = z.record(z.string(), z.number().finite().nonnegative())

/**
 * Intra-slip arithmetic check for one slip. Verifies the grossed-up taxable and
 * DTC boxes against the actual amount within a rounding tolerance, for both the
 * non-eligible (10/11/12) and eligible (24/25/26) dividend triples. Overrides
 * that break the relationship surface as warnings (the route requires explicit
 * acknowledgement — design finding #14).
 */
function checkT5Arithmetic(slip: LoadedSlip, taxYear: number): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const f = dividendRates(taxYear)
  const TOL = 0.02 // two cents of rounding slack

  const triples: Array<[string, string, string, { grossUp: number; dtcOfTaxable: number }]> = [
    ['box10', 'box11', 'box12', f.nonEligible],
    ['box24', 'box25', 'box26', f.eligible],
  ]
  for (const [actualK, taxableK, dtcK, factors] of triples) {
    const actual = eff(slip, actualK)
    const taxable = eff(slip, taxableK)
    const dtc = eff(slip, dtcK)
    if (actual === undefined && taxable === undefined && dtc === undefined) continue
    if (actual !== undefined && taxable !== undefined) {
      const expected = round2(actual * (1 + factors.grossUp))
      if (Math.abs(expected - taxable) > TOL) {
        issues.push({
          level: 'warning',
          code: 'INTRA_SLIP_TAXABLE',
          slipId: slip.id,
          message: `${taxableK} (${taxable}) ≠ ${actualK}×${1 + factors.grossUp} (${expected}) — override breaks gross-up; acknowledge to file.`,
        })
      }
    }
    if (taxable !== undefined && dtc !== undefined) {
      const expected = round2(taxable * factors.dtcOfTaxable)
      if (Math.abs(expected - dtc) > TOL) {
        issues.push({
          level: 'warning',
          code: 'INTRA_SLIP_DTC',
          slipId: slip.id,
          message: `${dtcK} (${dtc}) ≠ ${taxableK}×${factors.dtcOfTaxable} (${expected}) — override breaks DTC; acknowledge to file.`,
        })
      }
    }
  }
  return issues
}

/** Sum effective box values across slips, keyed by descriptor box key. */
function footSummary(type: string, slips: LoadedSlip[]): Record<string, number> {
  const keys = (type === 'T5' ? T5_BOXES : T4A_BOXES).map((d) => d.key)
  const totals: Record<string, number> = {}
  for (const k of keys) {
    let sum = 0
    for (const s of slips) sum += eff(s, k) ?? 0
    totals[k] = round2(sum)
  }
  return totals
}

/**
 * Run the optional xmllint XSD gate. Returns `{ran:false}` (a warning, not an
 * error) when the XSD file is absent so the build degrades gracefully. When the
 * XSD is present, a schema failure is a hard error.
 */
function runXsdGate(type: string, xml: string): { ran: boolean; passed: boolean; note: string } {
  const xsdPath = path.join(XSD_DIR, `${type}.xsd`)
  if (!fs.existsSync(xsdPath)) {
    return {
      ran: false,
      passed: true,
      note: `XSD not installed at src/lib/tax/xsd/${type}.xsd — schema validation skipped (graceful degrade). Source the CRA ${type}/T619 XSD to enable the hard gate.`,
    }
  }
  let tmp = ''
  try {
    tmp = path.join(os.tmpdir(), `tax-${type}-${crypto.randomUUID()}.xml`)
    fs.writeFileSync(tmp, xml, 'utf8')
    const res = spawnSync('xmllint', ['--noout', '--schema', xsdPath, tmp], {
      encoding: 'utf8',
    })
    if (res.error) {
      return {
        ran: false,
        passed: true,
        note: `xmllint unavailable (${res.error.message}) — schema validation skipped (graceful degrade).`,
      }
    }
    const passed = res.status === 0
    return {
      ran: true,
      passed,
      note: passed
        ? `Validated against src/lib/tax/xsd/${type}.xsd.`
        : `XSD validation FAILED: ${(res.stderr || '').trim().slice(0, 2000)}`,
    }
  } finally {
    if (tmp) {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

/**
 * Build the filing export for a slip type and year. Pure of side effects on the
 * DB except for reads; the caller persists the FilingExport row. Throws only on
 * unexpected programmer errors — all expected validation failures are reported
 * in `report.issues` with `report.ok === false`.
 */
export async function buildFilingExport(
  type: 'T5' | 'T4A',
  taxYear: number,
  options: { slipIds?: string[] } = {}
): Promise<BuildFilingResult> {
  const issues: ValidationIssue[] = []
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  const company = await getCompanySettings()

  // Filer identity gate (design §6.2).
  const businessNumber = settings?.businessNumber?.trim() || ''
  const rzAccount = settings?.rzAccountInfoReturns?.trim() || ''
  const transmitterNumber = settings?.craTransmitterNumber?.trim() || ''
  const legalName = (company.legalName || company.name)?.trim() || ''
  const filerAddress = company.addressSingleLine || ''

  if (!businessNumber) issues.push({ level: 'error', code: 'FILER_BN', message: 'Filer business number (BN) is required.' })
  if (!rzAccount) issues.push({ level: 'error', code: 'FILER_RZ', message: 'Filer RZ (information-returns) account is required.' })
  if (!legalName) issues.push({ level: 'error', code: 'FILER_NAME', message: 'Filer legal name is required.' })

  // Effective slips for the year (tail per slipNumber, cancelled excluded).
  const effective = await effectiveSlipsForYear(type, taxYear)
  let scoped = effective
  if (options.slipIds && options.slipIds.length > 0) {
    const want = new Set(options.slipIds)
    scoped = effective.filter((s) => want.has(s.id))
  }

  const full = await prisma.taxSlip.findMany({
    where: { id: { in: scoped.map((s) => s.id) } },
    select: {
      id: true,
      type: true,
      status: true,
      reportCode: true,
      slipNumber: true,
      boxes: true,
      boxesOverride: true,
      recipientNameSnapshot: true,
      recipientAddressSnapshot: true,
      recipientBnSnapshot: true,
      recipientSinCipher: true,
    },
  })
  const slips = full as unknown as LoadedSlip[]

  if (slips.length === 0) {
    issues.push({ level: 'error', code: 'NO_SLIPS', message: `No effective ${type} slips for ${taxYear}.` })
  }

  // Per-slip gates: no drafts, slipNumber allocated, SIN xor BN, Luhn, boxes.
  const xmlSlips: SlipXmlInput[] = []
  for (const s of slips) {
    if (s.status === 'draft') {
      issues.push({ level: 'error', code: 'DRAFT_IN_SET', slipId: s.id, message: `Slip ${s.id} is a draft and cannot be filed.` })
    }
    if (!s.slipNumber) {
      issues.push({ level: 'error', code: 'NO_SLIP_NUMBER', slipId: s.id, message: `Slip ${s.id} has no allocated slip number.` })
    }

    let sin: string | null = null
    const hasCipher = !!s.recipientSinCipher
    const hasBn = !!(s.recipientBnSnapshot && s.recipientBnSnapshot.trim())
    if (hasCipher && hasBn) {
      issues.push({ level: 'error', code: 'SIN_XOR_BN', slipId: s.id, message: `Slip ${s.id} has both a SIN and a BN; exactly one is allowed.` })
    }
    if (!hasCipher && !hasBn) {
      issues.push({ level: 'error', code: 'SIN_OR_BN_MISSING', slipId: s.id, message: `Slip ${s.id} has neither a SIN nor a BN.` })
    }
    if (hasCipher) {
      try {
        sin = decryptSin(s.recipientSinCipher as string)
        if (!isValidSin(sin)) {
          issues.push({ level: 'error', code: 'SIN_LUHN', slipId: s.id, message: `Slip ${s.id} SIN fails the Luhn checksum.` })
        }
      } catch {
        issues.push({ level: 'error', code: 'SIN_DECRYPT', slipId: s.id, message: `Slip ${s.id} SIN could not be decrypted (key/version mismatch).` })
      }
    }
    if (!s.recipientAddressSnapshot?.trim()) {
      issues.push({ level: 'warning', code: 'RCPNT_ADDR', slipId: s.id, message: `Slip ${s.id} has no recipient address.` })
    }

    // Box schema + intra-slip arithmetic.
    const effBoxes: Record<string, number> = {}
    for (const k of Object.keys(s.boxes ?? {})) {
      const v = eff(s, k)
      if (v !== undefined) effBoxes[k] = v
    }
    const parsed = boxSchema.safeParse(effBoxes)
    if (!parsed.success) {
      issues.push({ level: 'error', code: 'BOX_SCHEMA', slipId: s.id, message: `Slip ${s.id} box values invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}` })
    }
    if (type === 'T5') issues.push(...checkT5Arithmetic(s, taxYear))

    xmlSlips.push({
      sin,
      recipientBn: hasBn ? (s.recipientBnSnapshot as string) : null,
      recipientName: s.recipientNameSnapshot,
      recipientAddress: s.recipientAddressSnapshot,
      boxes: s.boxes,
      boxesOverride: s.boxesOverride,
      reportCode: s.reportCode,
      slipNumber: s.slipNumber,
    })
  }

  // Summary foots to Σ effective slips (this IS the live summary, by construction).
  const summaryTotals = footSummary(type, slips)

  // Regenerate XML in memory.
  const filer: FilerXmlInput = {
    legalName,
    businessNumber,
    rzAccount,
    address: filerAddress,
    transmitterNumber,
    taxYear,
  }
  const xml = serializeReturn(type, filer, xmlSlips, summaryTotals)
  const checksum = crypto.createHash('sha256').update(xml, 'utf8').digest('hex')

  // Optional XSD gate (graceful degrade when absent).
  const xsd = runXsdGate(type, xml)
  if (xsd.ran && !xsd.passed) {
    issues.push({ level: 'error', code: 'XSD', message: xsd.note })
  } else if (!xsd.ran) {
    issues.push({ level: 'warning', code: 'XSD_SKIPPED', message: xsd.note })
  }

  const ok = issues.every((i) => i.level !== 'error')

  return {
    report: {
      ok,
      checkedAt: new Date().toISOString(),
      type,
      taxYear,
      slipCount: slips.length,
      issues,
      xsd,
      summaryTotals,
    },
    xml,
    checksum,
    slipIds: slips.map((s) => s.id),
    filerSnapshot: { legalName, bnRz: `${businessNumber} ${rzAccount}`.trim(), address: filerAddress },
  }
}

/** Map a slip type to its FilingExport.kind. */
export function filingKindForType(type: string): string {
  return KIND_BY_TYPE[type] ?? `${type.toLowerCase()}_return`
}
