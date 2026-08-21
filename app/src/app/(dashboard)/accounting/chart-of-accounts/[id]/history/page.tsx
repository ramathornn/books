export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate } from '@/lib/utils'
import SplitTooltip from '@/components/accounting/SplitTooltip'

const CLASS_LABEL_MAP: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
}

function isDebitNormal(cls: string) {
  return cls === 'asset' || cls === 'expense'
}

export default async function AccountHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const account = await prisma.gLAccount.findUnique({ where: { id } })
  if (!account) return notFound()

  const allAccounts = await prisma.gLAccount.findMany({
    where: { isArchived: false },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    select: { id: true, accountName: true, accountNumber: true, accountClass: true },
  })

  // Pull all JE lines on this account with the parent JE and its other lines (for offset).
  const lines = await prisma.journalEntryLine.findMany({
    where: { glAccountId: id, journalEntry: { status: 'posted' } },
    include: {
      journalEntry: {
        include: {
          lines: { include: { glAccount: true } },
        },
      },
    },
    orderBy: [{ journalEntry: { entryDate: 'asc' } }, { sortOrder: 'asc' }],
  })

  // Compute running balance from opening balance, debit-normal direction
  const debitNormal = isDebitNormal(account.accountClass)
  let running = Number(account.openingBalance)

  type Row = {
    id: string
    journalEntryId: string
    date: Date
    entryNumber: string
    journalDescription: string
    type: string
    offsetAccountLabel: string
    isSplit: boolean
    splitLines: Array<{ accountNumber: string; accountName: string; amount: number }>
    memo: string
    debit: number
    credit: number
    increase: number
    decrease: number
    isReconciled: boolean
    runningBalance: number
  }

  const rows: Row[] = lines.map((l) => {
    const debit = Number(l.debit)
    const credit = Number(l.credit)
    const delta = debitNormal ? debit - credit : credit - debit
    running += delta
    const increase = delta > 0 ? Math.abs(delta) : 0
    const decrease = delta < 0 ? Math.abs(delta) : 0

    // Determine offsetting account(s)
    const otherLines = l.journalEntry.lines.filter((x) => x.id !== l.id)
    let offsetLabel = ''
    let isSplit = false
    if (otherLines.length === 0) offsetLabel = '—'
    else if (otherLines.length === 1) {
      const o = otherLines[0]
      offsetLabel = `${o.glAccount.accountNumber} ${o.glAccount.accountName}`
    } else {
      offsetLabel = '-Split-'
      isSplit = true
    }
    // For the split popover: signed amount on each other line, in the conventional register sign convention
    // (positive = increases its account's natural balance, negative = decreases).
    const splitLines = otherLines.map((o) => {
      const oDebitNormal = isDebitNormal(o.glAccount.accountClass)
      const signed = oDebitNormal
        ? Number(o.debit) - Number(o.credit)
        : Number(o.credit) - Number(o.debit)
      return {
        accountNumber: o.glAccount.accountNumber,
        accountName: o.glAccount.accountName,
        amount: signed,
      }
    })

    // Type heuristic: derive from JE description prefix (e.g. "Bank: ...", "Bill payment: ...", "Payment for invoice ...")
    const desc = l.journalEntry.description
    let type = 'Journal'
    if (desc.startsWith('Bank: ')) type = 'Expense'
    else if (desc.startsWith('Bill ')) type = 'Bill'
    else if (desc.startsWith('Bill payment')) type = 'Bill payment'
    else if (desc.startsWith('Payment for invoice')) type = 'Payment'
    else if (desc.startsWith('Transfer')) type = 'Transfer'
    else if (desc.startsWith('Opening balance')) type = 'Opening Bal.'
    else if (desc.startsWith('GST/HST')) type = 'GST/HST'

    return {
      id: l.id,
      journalEntryId: l.journalEntry.id,
      date: l.journalEntry.entryDate,
      entryNumber: l.journalEntry.entryNumber,
      journalDescription: desc,
      type,
      offsetAccountLabel: offsetLabel,
      isSplit,
      splitLines,
      memo: l.description || l.journalEntry.memo || '',
      debit,
      credit,
      increase,
      decrease,
      isReconciled: false, // future: derive from BankTransaction.isReconciled when linked
      runningBalance: running,
    }
  })

  // Reverse so most recent first (register default)
  rows.reverse()

  const endingBalance = Number(account.currentBalance)
  const reverseSign = !debitNormal // for liability/equity/income, balances are credit-normal — display unsigned positive

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting/chart-of-accounts" className="text-[#0075DD] hover:underline">
          ← Back to Chart of Accounts
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1
            className="text-[24px] sm:text-[32px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {CLASS_LABEL_MAP[account.accountClass] || ''} Account History
          </h1>
          <select
            defaultValue={account.id}
            className="h-9 px-3 border border-[#E1E6EB] rounded text-sm bg-white"
          >
            {allAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} {a.accountName}
              </option>
            ))}
          </select>
        </div>
        <div className="text-right">
          <div className="text-xs text-[#576981] uppercase">Ending balance</div>
          <div className={`text-2xl font-semibold ${endingBalance < 0 ? 'text-[#BF2600]' : 'text-[#001B40]'}`}>
            {formatCurrency(endingBalance, account.currency, { includeCode: false })}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E1E6EB] flex items-center justify-between">
          <div className="text-sm">
            <span className="text-[#576981]">Showing </span>
            <strong className="text-[#001B40]">{rows.length}</strong>
            <span className="text-[#576981]"> {rows.length === 1 ? 'entry' : 'entries'}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/accounting/journal-entries/new" className="text-[#0075DD] hover:underline">
              + Add journal entry
            </Link>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-[#576981]">
            No transactions for this account yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Date ▼</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">
                    <div>Ref no.</div>
                    <div>Type</div>
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">
                    <div>Payee</div>
                    <div>Account</div>
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Memo</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">
                    Increase ({account.currency})
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">
                    Decrease ({account.currency})
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-[#576981]">✓</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">
                    Balance ({account.currency})
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/40">
                    <td className="px-3 py-2 text-[#001B40] whitespace-nowrap align-top">{formatDate(r.date)}</td>
                    <td className="px-3 py-2 text-xs align-top">
                      <Link
                        href={`/accounting/journal-entries/${r.journalEntryId}`}
                        className="font-mono text-[#0075DD] hover:underline"
                      >
                        {r.entryNumber}
                      </Link>
                      <div className="text-[#576981]">{r.type}</div>
                    </td>
                    <td className="px-3 py-2 text-xs align-top">
                      {r.isSplit ? (
                        <SplitTooltip lines={r.splitLines} currency={account.currency} />
                      ) : (
                        <span className="text-[#001B40]">{r.offsetAccountLabel}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#001B40] align-top max-w-[260px]">
                      <div className="truncate" title={r.memo || r.journalDescription}>
                        {r.memo || r.journalDescription}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono align-top text-[#001B40]">
                      {r.increase > 0 ? formatCurrency(r.increase, account.currency, { includeCode: false }) : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-mono align-top text-[#001B40]">
                      {r.decrease > 0 ? formatCurrency(r.decrease, account.currency, { includeCode: false }) : ''}
                    </td>
                    <td className="px-3 py-2 text-center align-top text-[#576981]">
                      {r.isReconciled ? '✓' : ''}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono align-top ${
                        r.runningBalance < 0 ? 'text-[#BF2600]' : 'text-[#001B40]'
                      }`}
                    >
                      {formatCurrency(reverseSign ? -r.runningBalance : r.runningBalance, account.currency, { includeCode: false })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
