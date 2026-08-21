import fs from 'node:fs'
import path from 'node:path'

import { PDFDocument } from 'pdf-lib'

import { T5_BOXES, type BoxDescriptor } from '@/lib/tax/descriptors/t5'
import { T4A_BOXES } from '@/lib/tax/descriptors/t4a'
import { money2 } from '@/lib/tax/round'

/**
 * Form-fill the OFFICIAL CRA fillable T5 / T4A PDF for a recipient copy
 * (substitute-slip compliance — design §3 / spec line 40), using pdf-lib's
 * AcroForm API keyed by each box's `acroField` name from the descriptor.
 *
 * GRACEFUL DEGRADE (hard requirement): the official CRA fillable PDFs are NOT
 * yet sourced. When the template file is absent — or a named AcroForm field is
 * missing from whatever template gets installed — this returns a structured
 * "not installed" / "field missing" result instead of crashing. The caller
 * (the slip PDF route) falls back to the @react-pdf functional slip in that
 * case, so the runtime never breaks while the official templates are pending.
 *
 * Templates, once sourced, live at:
 *   src/lib/tax/pdf/templates/{T5,T4A}.pdf
 * with AcroForm field names matching the descriptor `acroField` values
 * (placeholders today — design §6 Q7 fixes the exact contract).
 */

const TEMPLATE_DIR = path.join(process.cwd(), 'src', 'lib', 'tax', 'pdf', 'templates')

export interface FillSlipInput {
  type: 'T5' | 'T4A'
  /** effective box values (override ?? computed), keyed by box key. */
  boxes: Record<string, number>
  recipient: {
    name: string
    address: string
    /** masked or full SIN string for the recipient copy; printed verbatim. */
    sinDisplay?: string
    businessNumber?: string
  }
  filer: {
    legalName: string
    businessNumber: string
    address: string
  }
  taxYear: number
}

export type FillSlipResult =
  | {
      ok: true
      bytes: Uint8Array
      filledFields: string[]
      missingFields: string[]
    }
  | {
      ok: false
      reason: 'template_missing' | 'fill_error'
      note: string
    }

function boxesForType(type: string): BoxDescriptor[] {
  if (type === 'T5') return T5_BOXES
  if (type === 'T4A') return T4A_BOXES
  return []
}

/** Non-box AcroForm field names (identity block) — also placeholders. */
const IDENTITY_FIELDS = {
  recipientName: 'Recipient_Name',
  recipientAddress: 'Recipient_Address',
  recipientSin: 'Recipient_SIN',
  recipientBn: 'Recipient_BN',
  filerName: 'Payer_Name',
  filerBn: 'Payer_BN',
  filerAddress: 'Payer_Address',
  taxYear: 'Tax_Year',
} as const

/**
 * Try to set a text field by name; records whether it existed. Tolerant of
 * pdf-lib throwing when the field is absent or not a text field, so a partially
 * matching template still produces a best-effort slip.
 */
function trySetText(
  form: ReturnType<PDFDocument['getForm']>,
  name: string,
  value: string,
  filled: string[],
  missing: string[]
): void {
  if (!value) return
  try {
    const field = form.getTextField(name)
    field.setText(value)
    filled.push(name)
  } catch {
    missing.push(name)
  }
}

/**
 * Fill the official CRA slip. Returns a graceful failure result when the
 * template is missing or pdf-lib cannot load/flatten it — never throws for the
 * expected "templates not installed" path.
 */
export async function fillCraSlip(input: FillSlipInput): Promise<FillSlipResult> {
  const templatePath = path.join(TEMPLATE_DIR, `${input.type}.pdf`)
  if (!fs.existsSync(templatePath)) {
    return {
      ok: false,
      reason: 'template_missing',
      note: `Official CRA fillable ${input.type} template not installed at src/lib/tax/pdf/templates/${input.type}.pdf — falling back to the functional @react-pdf slip. Source the CRA fillable PDF + AcroForm field names to enable official-form fill.`,
    }
  }

  try {
    const templateBytes = fs.readFileSync(templatePath)
    const pdf = await PDFDocument.load(templateBytes)
    const form = pdf.getForm()
    const filled: string[] = []
    const missing: string[] = []

    // Box amounts, keyed by the descriptor's AcroForm field name.
    for (const d of boxesForType(input.type)) {
      const v = input.boxes[d.key]
      if (v === null || v === undefined) continue
      trySetText(form, d.acroField, money2(Number(v)), filled, missing)
    }

    // Identity block.
    trySetText(form, IDENTITY_FIELDS.recipientName, input.recipient.name, filled, missing)
    trySetText(form, IDENTITY_FIELDS.recipientAddress, input.recipient.address, filled, missing)
    if (input.recipient.sinDisplay)
      trySetText(form, IDENTITY_FIELDS.recipientSin, input.recipient.sinDisplay, filled, missing)
    if (input.recipient.businessNumber)
      trySetText(form, IDENTITY_FIELDS.recipientBn, input.recipient.businessNumber, filled, missing)
    trySetText(form, IDENTITY_FIELDS.filerName, input.filer.legalName, filled, missing)
    trySetText(form, IDENTITY_FIELDS.filerBn, input.filer.businessNumber, filled, missing)
    trySetText(form, IDENTITY_FIELDS.filerAddress, input.filer.address, filled, missing)
    trySetText(form, IDENTITY_FIELDS.taxYear, String(input.taxYear), filled, missing)

    // Flatten so the recipient copy is non-editable; tolerate flatten quirks.
    try {
      form.flatten()
    } catch {
      /* some templates have annotations that resist flatten; keep editable */
    }

    const bytes = await pdf.save()
    return { ok: true, bytes, filledFields: filled, missingFields: missing }
  } catch (err) {
    return {
      ok: false,
      reason: 'fill_error',
      note: `Failed to fill official ${input.type} template: ${(err as Error).message}. Falling back to the functional @react-pdf slip.`,
    }
  }
}
