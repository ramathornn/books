/**
 * Document intake: take an uploaded receipt/invoice (image or PDF), OCR it,
 * sanitise the vendor, and try to attach it to the single posted expense journal
 * entry it confidently belongs to. If the match isn't unique + confident we never
 * auto-attach (a wrong match is worse than a gap for an audit trail) — the caller
 * gets ranked candidates for a one-click confirm instead.
 *
 * The confident/ambiguous decision is the pure, unit-tested `selectMatch`
 * (jeMatch.ts); this module adds the OCR + DB/fs wiring around it.
 */
import 'server-only'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { ensureEntityDir, relativeStoragePath } from '@/lib/attachments'
import { selectMatch, type JeCandidate, type MatchResult } from '@/lib/jeMatch'
import { cleanVendor } from '@/lib/cleanVendor'
import { convertToCad } from '@/lib/fx'
import { extractReceipt } from '@/lib/receiptOcr'
import { getCompanySettings } from '@/lib/company'

/** MIME types we can OCR (image/PDF). Other types need manual entry. */
export const OCR_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
])

export interface IntakeFile {
  originalName: string
  mimeType: string
  buffer: Buffer
}

interface OcrFields {
  vendor: string | null
  total: number
  date: string | null
  currency: string | null
}

export interface IntakeCandidate {
  id: string
  date: string // YYYY-MM-DD
  amount: number
  description: string
}

export type IngestResult =
  | { status: 'attached'; journalEntryId: string; vendor: string | null }
  | { status: 'candidates'; vendor: string | null; ocr: OcrFields; candidates: IntakeCandidate[] }
  | { status: 'no_match'; vendor: string | null; ocr: OcrFields }
  | { status: 'unsupported' }
  | { status: 'ocr_failed' }

/** Own-org names/aliases so cleanVendor rejects mailbox/workspace chrome that
 *  echoes the company name. Config (CompanySettings + OWN_ORG_ALIASES env). */
export async function loadOwnOrgNames(): Promise<string[]> {
  const c = await getCompanySettings()
  const env = (process.env.OWN_ORG_ALIASES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [c.name, c.legalName, ...env].filter((x): x is string => !!x)
}

/** Persist a file as an Attachment on a journal entry. */
async function writeAttachment(entityId: string, file: IntakeFile): Promise<void> {
  const dir = await ensureEntityDir('journal_entry', entityId)
  const ext = path.extname(file.originalName).toLowerCase() || '.bin'
  const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
  await fs.writeFile(path.join(dir, safeName), file.buffer)
  await prisma.attachment.create({
    data: {
      entityType: 'journal_entry',
      entityId,
      fileName: file.originalName,
      storagePath: relativeStoragePath('journal_entry', entityId, safeName),
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
    },
  })
}

/**
 * Fetch the posted expense JEs within ±5 days of the receipt date and run the
 * pure matcher. A foreign-currency receipt is converted to CAD (Bank of Canada
 * rate) first, since posted JEs are CAD.
 */
export async function matchDocumentToJE(ocr: OcrFields): Promise<MatchResult> {
  if (!ocr.date || !(ocr.total > 0)) return { je: null, ambiguous: false, candidates: [] }
  const d = new Date(ocr.date)
  if (Number.isNaN(d.getTime())) return { je: null, ambiguous: false, candidates: [] }
  const lo = new Date(d.getTime() - 5 * 86_400_000)
  const hi = new Date(d.getTime() + 5 * 86_400_000)

  const jes = await prisma.journalEntry.findMany({
    where: {
      status: 'posted',
      entryDate: { gte: lo, lte: hi },
      lines: { some: { glAccount: { accountClass: 'expense' } } },
    },
    select: { id: true, entryDate: true, totalDebit: true, description: true, memo: true },
  })
  const candidates: JeCandidate[] = jes.map((j) => ({
    id: j.id,
    entryDate: j.entryDate,
    totalDebit: Number(j.totalDebit),
    description: j.description,
    memo: j.memo,
  }))

  const currency = (ocr.currency || 'CAD').toUpperCase()
  let cadTotal: number | undefined
  if (currency !== 'CAD' && ocr.total > 0) {
    try {
      cadTotal = await convertToCad(ocr.total, currency, d)
    } catch {
      cadTotal = undefined // no rate → fall back to same-currency match
    }
  }

  return selectMatch({ vendor: ocr.vendor, total: ocr.total, date: ocr.date, currency, cadTotal }, candidates)
}

function toIntakeCandidate(c: JeCandidate): IntakeCandidate {
  return {
    id: c.id,
    date: c.entryDate.toISOString().slice(0, 10),
    amount: c.totalDebit,
    description: `${c.description} ${c.memo}`.trim(),
  }
}

/**
 * OCR an uploaded document, sanitise the vendor, and attach to its unique posted
 * JE — or return candidates / no-match. Never auto-attaches on a non-unique match.
 */
export async function ingestDocument(file: IntakeFile): Promise<IngestResult> {
  if (!OCR_MIME.has(file.mimeType)) return { status: 'unsupported' }

  const raw = await extractReceipt({ buffer: file.buffer, mimeType: file.mimeType })
  if (!raw) return { status: 'ocr_failed' }

  const ownOrgNames = await loadOwnOrgNames()
  const vendor = cleanVendor(raw.vendor, { ownOrgNames })
  const ocr: OcrFields = {
    vendor,
    total: raw.total,
    date: raw.date || null,
    currency: raw.currency || null,
  }

  const match = await matchDocumentToJE(ocr)

  if (match.je) {
    await writeAttachment(match.je.id, file)
    return { status: 'attached', journalEntryId: match.je.id, vendor }
  }

  if (match.candidates.length > 0) {
    return { status: 'candidates', vendor, ocr, candidates: match.candidates.map(toIntakeCandidate) }
  }
  return { status: 'no_match', vendor, ocr }
}

/** Attach an uploaded document to a JE the user picked from the candidates. */
export async function attachDocumentToJE(jeId: string, file: IntakeFile): Promise<void> {
  await writeAttachment(jeId, file)
}
