import fs from 'node:fs/promises'
import prisma from '@/lib/prisma'
import { ensureFilesDir, newStoragePath, absolutePath, validateName } from '@/lib/files'
import { receiptDisplayName } from '@/lib/receiptName'

// Bridges the Receipts inbox (Attachment + draft Expense) with the Files manager
// (Folder + StoredFile). When a receipt is uploaded we drop a copy of the bytes
// into Files → Receipts/YYYY-MM (by receipt date) so the user's folder structure
// stays populated, while the original attachment + expense flow is untouched.

// Name of the top-level folder receipts are filed under. Override via env if the
// real tree uses a different label.
const RECEIPTS_ROOT_NAME = process.env.RECEIPTS_ROOT_FOLDER || 'Receipts'

// Find a folder by (parentId, name); create it if missing. parentId null = root.
async function findOrCreateFolder(name: string, parentId: string | null): Promise<{ id: string }> {
  const existing = await prisma.folder.findFirst({
    where: { parentId, name },
    select: { id: true },
  })
  if (existing) return existing
  return prisma.folder.create({
    data: { name, parentId },
    select: { id: true },
  })
}

// "YYYY-MM" bucket for a given date (uses local server time, matching how the
// expense date is stored).
export function monthFolderName(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// Resolve (creating as needed) the Receipts/YYYY-MM folder for a date.
async function resolveMonthFolder(date: Date): Promise<string> {
  const root = await findOrCreateFolder(RECEIPTS_ROOT_NAME, null)
  const month = await findOrCreateFolder(monthFolderName(date), root.id)
  return month.id
}

// Copy a freshly-uploaded receipt's bytes into Files → Receipts/YYYY-MM and link
// the StoredFile back to its expense. Best-effort: returns null on any failure so
// callers can ignore errors and never block the primary receipt upload.
export async function fileReceiptIntoFolder(args: {
  expenseId: string
  date: Date
  originalName: string
  mimeType: string
  buffer: Buffer
  // Optional OCR/expense fields. When a vendor or amount is supplied the file is
  // given a standard searchable display name (YYYY-MM-DD_Vendor_AMOUNTCCY.ext);
  // otherwise the validated original name is kept. Display name only — the
  // on-disk storagePath stays a uuid, so no links break.
  vendor?: string | null
  amount?: number | null
  currency?: string | null
}): Promise<{ id: string; folderId: string } | null> {
  try {
    const folderId = await resolveMonthFolder(args.date)

    await ensureFilesDir()
    const { storagePath } = newStoragePath(args.originalName)
    await fs.writeFile(absolutePath(storagePath), args.buffer, { mode: 0o600 })

    let displayName: string
    if (args.vendor || typeof args.amount === 'number') {
      displayName = receiptDisplayName({
        vendor: args.vendor,
        date: args.date,
        amount: args.amount,
        currency: args.currency,
        originalName: args.originalName,
      })
    } else {
      const nameCheck = validateName(args.originalName)
      displayName = nameCheck.ok ? nameCheck.name : `receipt-${Date.now()}`
    }

    const created = await prisma.storedFile.create({
      data: {
        name: displayName,
        folderId,
        storagePath,
        mimeType: args.mimeType,
        sizeBytes: args.buffer.length,
        expenseId: args.expenseId,
      },
      select: { id: true },
    })
    return { id: created.id, folderId }
  } catch (err) {
    console.error('fileReceiptIntoFolder failed:', err)
    return null
  }
}

// When an expense's date is edited during review, move its filed receipt copy to
// the matching Receipts/YYYY-MM folder. Best-effort; no-op if nothing is linked or
// it's already in the right month folder.
export async function refileReceiptByDate(expenseId: string, date: Date): Promise<void> {
  try {
    const filed = await prisma.storedFile.findMany({
      where: { expenseId },
      select: { id: true, folderId: true },
    })
    if (filed.length === 0) return

    const targetFolderId = await resolveMonthFolder(date)
    await Promise.all(
      filed
        .filter((f) => f.folderId !== targetFolderId)
        .map((f) =>
          prisma.storedFile.update({ where: { id: f.id }, data: { folderId: targetFolderId } })
        )
    )
  } catch (err) {
    console.error('refileReceiptByDate failed:', err)
  }
}
