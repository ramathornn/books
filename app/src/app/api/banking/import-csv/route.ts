import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { importBankTransactions } from '@/lib/bankImport'
import { parseCsvRows } from '@/lib/csv'
import {
  PRESETS,
  detectPreset,
  buildColumnMapForPreset,
  mapRows,
  type PresetKey,
} from '@/lib/bankCsvMap'

// POST /api/banking/import-csv — headless CSV import (multipart/form-data).
//
// Fields:
//   bank_account_id (string, required)
//   file            (the raw CSV, required)
//   format          (optional: rbc_business | rbc_personal | wise | custom)
//                    overrides header auto-detection
//
// Mirrors the in-app wizard exactly: it shares the column-mapping/preset/date
// logic in src/lib/bankCsvMap.ts and the dedup + PENDING staging in
// importBankTransactions. Returns 200 { ok, new, duplicate, ... } on success.
export async function POST(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json(
      { error: 'Expected multipart/form-data with bank_account_id and file' },
      { status: 400 }
    )
  }

  const bankAccountId = String(form.get('bank_account_id') || '').trim()
  if (!bankAccountId) {
    return Response.json({ error: 'bank_account_id required' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'file required' }, { status: 400 })
  }
  if (file.size === 0) {
    return Response.json({ error: 'CSV file is empty' }, { status: 400 })
  }

  // Optional preset override. Reject unknown keys so typos fail loudly.
  const formatRaw = form.get('format')
  let formatOverride: PresetKey | null = null
  if (typeof formatRaw === 'string' && formatRaw.trim()) {
    const key = formatRaw.trim()
    if (!(key in PRESETS)) {
      return Response.json(
        { error: `Unknown format '${key}'. Expected one of: ${Object.keys(PRESETS).join(', ')}` },
        { status: 400 }
      )
    }
    formatOverride = key as PresetKey
  }

  // Confirm the bank account exists before doing any parsing work.
  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } })
  if (!account) {
    return Response.json({ error: 'Bank account not found' }, { status: 404 })
  }

  // Parse the raw CSV server-side.
  const text = await file.text()
  const { headers, rows: rawRows } = parseCsvRows(text)
  if (headers.length === 0) {
    return Response.json({ error: 'Could not parse CSV (no header row found)' }, { status: 400 })
  }

  // Resolve the column mapping: explicit override > header auto-detect.
  const presetKey = formatOverride ?? detectPreset(headers)
  if (presetKey === 'custom') {
    return Response.json(
      {
        error:
          'Could not auto-detect the CSV format. Pass a `format` field (rbc_business, rbc_personal, or wise).',
      },
      { status: 400 }
    )
  }
  const columnMap = buildColumnMapForPreset(presetKey, headers)
  if (!columnMap.date || !columnMap.description) {
    return Response.json(
      {
        error: `CSV headers don't match the '${presetKey}' format (missing date/description columns).`,
      },
      { status: 400 }
    )
  }

  const rows = mapRows(headers, rawRows, columnMap)
  if (rows.length === 0) {
    return Response.json(
      { error: 'No valid rows could be parsed from the CSV.' },
      { status: 400 }
    )
  }

  const result = await importBankTransactions(bankAccountId, rows)

  return Response.json({
    ok: true,
    new: result.rowsInserted,
    duplicate: result.rowsDuplicate,
    rowsSkippedLocked: result.rowsSkippedLocked,
    lockedThrough: result.lockedThrough,
  })
}
