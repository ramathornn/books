/**
 * DB loader for the pure receiptRecon engine. Fetches the snapshot — posted
 * expense JEs + the THREE documentation anchors (an Attachment on the JE, on its
 * linked bank_transaction, or on its linked POSTED bill) + StoredFiles + the set
 * of Attachment storage paths + live Expense ids — and delegates the actual
 * classification to the tested pure module.
 *
 * No `import 'server-only'`: also reachable from a script. Touches Prisma + fs
 * (content-hashing for the duplicate pass) + the pure engine only.
 */
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { absolutePath as fileAbsolutePath } from '@/lib/files'
import {
  classifyMissing,
  classifyOrphans,
  classifyDuplicates,
  type JeRow,
  type MissingAnchors,
  type MissingRow,
  type StoredFileRow,
  type HashedFile,
  type DuplicateGroup,
} from '@/lib/receiptRecon'

// The ITC-receivable account a categorized expense debits when GST/HST is
// recoverable. Detected by account name across charts; a deployment can pin the
// exact account number via ITC_RECEIVABLE_ACCOUNT_NUMBER.
const ITC_RECEIVABLE_NUMBER = process.env.ITC_RECEIVABLE_ACCOUNT_NUMBER || ''
const ITC_RECEIVABLE_NAME = /receivable \(itc\)|input tax credit|gst\/hst receivable|gst receivable|hst receivable/i

export interface ReconResult {
  missing: MissingRow[]
  orphans: StoredFileRow[]
}

/** MISSING + ORPHAN (pure DB; no disk IO) — used by the report page and scripts. */
export async function loadMissingAndOrphans(): Promise<ReconResult> {
  const jes = await prisma.journalEntry.findMany({
    where: { status: 'posted', lines: { some: { glAccount: { accountClass: 'expense' } } } },
    select: {
      id: true,
      entryNumber: true,
      entryDate: true,
      totalDebit: true,
      description: true,
      memo: true,
      lines: {
        select: {
          glAccount: { select: { accountNumber: true, accountName: true, accountClass: true } },
        },
      },
    },
    orderBy: { entryDate: 'asc' },
  })
  const jeIds = jes.map((j) => j.id)

  // Anchor 1 — Attachment directly on the JE.
  const jeAtt = await prisma.attachment.findMany({
    where: { entityType: 'journal_entry', entityId: { in: jeIds }, isArchived: false },
    select: { entityId: true },
  })

  // Anchor 2 — Attachment on the bank_transaction that posted the JE.
  const bts = await prisma.bankTransaction.findMany({
    where: { journalEntryId: { in: jeIds } },
    select: { id: true, journalEntryId: true },
  })
  const btAtt = await prisma.attachment.findMany({
    where: { entityType: 'bank_transaction', entityId: { in: bts.map((b) => b.id) }, isArchived: false },
    select: { entityId: true },
  })
  const btWithAtt = new Set(btAtt.map((a) => a.entityId))
  const bankTxnAttached = new Set(
    bts.filter((b) => btWithAtt.has(b.id) && b.journalEntryId).map((b) => b.journalEntryId as string)
  )

  // Anchor 3 — Attachment on the POSTED bill that posted the JE.
  const bills = await prisma.bill.findMany({
    where: { journalEntryId: { in: jeIds } },
    select: { id: true, journalEntryId: true },
  })
  const billAtt = await prisma.attachment.findMany({
    where: { entityType: 'bill', entityId: { in: bills.map((b) => b.id) }, isArchived: false },
    select: { entityId: true },
  })
  const billWithAtt = new Set(billAtt.map((a) => a.entityId))
  const billAttached = new Set(
    bills.filter((b) => billWithAtt.has(b.id) && b.journalEntryId).map((b) => b.journalEntryId as string)
  )

  const anchors: MissingAnchors = {
    jeAttached: new Set(jeAtt.map((a) => a.entityId)),
    bankTxnAttached,
    billAttached,
  }

  const jeRows: JeRow[] = jes.map((j) => {
    const expenseLines = j.lines.filter((l) => l.glAccount.accountClass === 'expense')
    const a = expenseLines[0]?.glAccount
    const itcBearing = j.lines.some(
      (l) =>
        (!!ITC_RECEIVABLE_NUMBER && l.glAccount.accountNumber === ITC_RECEIVABLE_NUMBER) ||
        ITC_RECEIVABLE_NAME.test(l.glAccount.accountName)
    )
    return {
      id: j.id,
      entryNumber: j.entryNumber,
      date: j.entryDate.toISOString().slice(0, 10),
      amount: Number(j.totalDebit),
      account: a ? `${a.accountNumber} ${a.accountName}` : '',
      accountNames: expenseLines.map((l) => l.glAccount.accountName),
      description: `${j.description} ${j.memo}`.trim(),
      itcBearing,
    }
  })
  const missing = classifyMissing(jeRows, anchors)

  // ORPHAN — StoredFile copies tied to no live Expense and referenced by no Attachment.
  const files = await prisma.storedFile.findMany({
    select: { id: true, name: true, storagePath: true, expenseId: true, folder: { select: { name: true } } },
  })
  const attPaths = new Set(
    (await prisma.attachment.findMany({ select: { storagePath: true } })).map((a) => a.storagePath)
  )
  const liveExpenseIds = new Set(
    (await prisma.expense.findMany({ select: { id: true } })).map((e) => e.id)
  )
  const sfRows: StoredFileRow[] = files.map((f) => ({
    id: f.id,
    name: f.name,
    storagePath: f.storagePath,
    expenseId: f.expenseId,
    folder: f.folder?.name ?? null,
  }))
  const orphans = classifyOrphans(sfRows, attPaths, liveExpenseIds)

  return { missing, orphans }
}

/** DUPLICATE — content-hashed StoredFiles (disk IO). Used by the report + scripts. */
export async function loadDuplicates(): Promise<{ groups: DuplicateGroup[]; unreadable: StoredFileRow[] }> {
  const files = await prisma.storedFile.findMany({
    select: { id: true, name: true, storagePath: true, expenseId: true, sizeBytes: true, createdAt: true },
  })

  // Pre-filter: a duplicate must share its byte length, so only hash size-collisions.
  const bySize = new Map<number, typeof files>()
  for (const f of files) {
    const arr = bySize.get(f.sizeBytes) ?? []
    arr.push(f)
    bySize.set(f.sizeBytes, arr)
  }

  const hashed: HashedFile[] = []
  const unreadable: StoredFileRow[] = []
  for (const [, arr] of bySize) {
    if (arr.length < 2) continue
    for (const f of arr) {
      try {
        const buf = await fs.readFile(fileAbsolutePath(f.storagePath))
        hashed.push({
          id: f.id,
          name: f.name,
          storagePath: f.storagePath,
          expenseId: f.expenseId,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          createdAt: f.createdAt.toISOString(),
        })
      } catch {
        unreadable.push({ id: f.id, name: f.name, storagePath: f.storagePath, expenseId: f.expenseId })
      }
    }
  }

  return { groups: classifyDuplicates(hashed), unreadable }
}
