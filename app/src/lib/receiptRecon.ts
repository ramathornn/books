/**
 * Pure source-document reconciliation engine (no DB/IO — the loader fetches the
 * snapshot and passes it in, so this stays unit-testable). Surfaces the three
 * exception classes every bookkeeping system must expose, anchored to CRA's
 * audit-trail requirement (each posted transaction traces to a source document):
 *
 *   MISSING   — posted expense JEs documented by NONE of three anchors: an
 *               Attachment on the JE itself, on its linked bank_transaction, or on
 *               its linked POSTED bill. (Checking only the JE anchor would
 *               false-positive documented bank/bill receipts.) Each survivor is
 *               tagged with an ITC amount tier + a domestic-GST flag so the report
 *               can prioritise the invoices that legally need chasing (GST/HST ITC
 *               requires the itemised invoice at $100+).
 *   ORPHAN    — StoredFile copies (Files→Receipts) tied to no live Expense and
 *               referenced by no Attachment — leftover from discarded drafts.
 *   DUPLICATE — StoredFiles sharing a content sha256 (one canonical, rest flagged).
 */

/** Account-name / memo classes that legitimately rarely have an emailed receipt. */
export const EXPECTED_GAP = /fee|interest|fx|foreign exchange|revaluation|depreciation|bank charge|opening/i

// ---- materiality / ITC tagging ----

export type AmountTier = '<100' | '100-499.99' | '500+'

/** CRA ITC documentary thresholds (raised 2021-04-20 to $100 / $500). */
export function amountTier(cad: number): AmountTier {
  if (cad >= 500) return '500+'
  if (cad >= 100) return '100-499.99'
  return '<100'
}

// ---- MISSING ----

export interface JeRow {
  id: string
  entryNumber: string
  date: string // YYYY-MM-DD
  amount: number // CAD (totalDebit)
  account: string // e.g. "6000 Advertising"
  accountNames: string[] // expense-line account names, for the EXPECTED_GAP test
  description: string
  /**
   * The JE booked recoverable GST/HST — it has a debit line to the ITC-receivable
   * account (GST/HST Receivable). Set by the loader. ITC-bearing gaps are the ones
   * that legally need the itemised invoice ($100+), so the report prioritises them;
   * foreign zero-rated charges (no ITC line) are deprioritised.
   */
  itcBearing: boolean
}

export interface MissingAnchors {
  /** JE ids with a non-archived journal_entry Attachment. */
  jeAttached: Set<string>
  /** JE ids whose linked bank_transaction carries a non-archived Attachment. */
  bankTxnAttached: Set<string>
  /** JE ids whose linked POSTED bill carries a non-archived Attachment. */
  billAttached: Set<string>
}

export interface MissingRow extends JeRow {
  amountTier: AmountTier
}

export function classifyMissing(jes: JeRow[], anchors: MissingAnchors): MissingRow[] {
  return jes
    .filter(
      (j) => !anchors.jeAttached.has(j.id) && !anchors.bankTxnAttached.has(j.id) && !anchors.billAttached.has(j.id)
    )
    .filter((j) => !EXPECTED_GAP.test(`${j.accountNames.join(' ')} ${j.description}`))
    .map((j) => ({ ...j, amountTier: amountTier(j.amount) }))
}

// ---- ORPHAN ----

export interface StoredFileRow {
  id: string
  name: string
  storagePath: string
  expenseId: string | null
  folder?: string | null
}

/**
 * A StoredFile is an orphan when it is tied to no live Expense AND its bytes are
 * referenced by no Attachment. The Attachment-path guard is a hard safety check:
 * we never want to flag (and later delete) a file the ledger points at.
 */
export function classifyOrphans(
  files: StoredFileRow[],
  attachmentStoragePaths: Set<string>,
  liveExpenseIds: Set<string>
): StoredFileRow[] {
  return files.filter((f) => {
    const liveLink = f.expenseId != null && liveExpenseIds.has(f.expenseId)
    const referenced = attachmentStoragePaths.has(f.storagePath)
    return !liveLink && !referenced
  })
}

// ---- DUPLICATE ----

export interface HashedFile {
  id: string
  name: string
  storagePath: string
  expenseId: string | null
  sha256: string
  createdAt: string // ISO
}

export interface DuplicateGroup {
  sha256: string
  canonical: HashedFile
  duplicates: HashedFile[]
}

/**
 * Group StoredFiles by content sha256 (NOT name+size — different bytes can share a
 * name, and identical bytes can differ in name). The canonical kept copy is the
 * expense-linked one if any, else the oldest; everything else in the group is a
 * duplicate. Rows with no hash (bytes missing on disk) are excluded — the script
 * reports those separately rather than risk a false "duplicate".
 */
export function classifyDuplicates(files: HashedFile[]): DuplicateGroup[] {
  const byHash = new Map<string, HashedFile[]>()
  for (const f of files) {
    if (!f.sha256) continue
    const arr = byHash.get(f.sha256) ?? []
    arr.push(f)
    byHash.set(f.sha256, arr)
  }

  const groups: DuplicateGroup[] = []
  for (const [sha256, arr] of byHash) {
    if (arr.length < 2) continue
    const sorted = [...arr].sort((a, b) => {
      const aLinked = a.expenseId != null ? 0 : 1
      const bLinked = b.expenseId != null ? 0 : 1
      if (aLinked !== bLinked) return aLinked - bLinked
      return a.createdAt.localeCompare(b.createdAt) // oldest first
    })
    groups.push({ sha256, canonical: sorted[0], duplicates: sorted.slice(1) })
  }
  return groups
}
