import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { audit } from '@/lib/audit'

// Post the unrealized FX revaluation as a balanced JE, with line per account
// and contra to "Unrealized Currency Gains" (or whatever Other-Income FX account exists).
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const asOf = new Date(String(body.asOf || ''))
  if (isNaN(asOf.getTime())) return Response.json({ error: 'asOf invalid' }, { status: 400 })

  interface Row {
    accountId: string
    unrealized: number
  }
  const rows: Row[] = Array.isArray(body.rows) ? body.rows : []
  const validRows = rows.filter((r) => Math.abs(r.unrealized) > 0.005)
  if (validRows.length === 0) return Response.json({ error: 'No non-zero rows' }, { status: 400 })

  // Find Unrealized Currency Gains account (or fall back to a similarly named one)
  const fxGains = await prisma.gLAccount.findFirst({
    where: {
      OR: [
        { accountName: { contains: 'Unrealized Currency', mode: 'insensitive' } },
        { detailType: 'Unrealized Currency Gains' },
        { accountName: { contains: 'Foreign Exchange', mode: 'insensitive' } },
      ],
    },
    orderBy: { accountNumber: 'asc' },
  })
  if (!fxGains) {
    return Response.json(
      { error: 'No Unrealized Currency Gains / Foreign Exchange account found in chart.' },
      { status: 500 }
    )
  }

  // Build JE lines — flip sign based on account class (asset gain → DR account, CR FX gain).
  const jeLines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = []
  let netGain = 0
  for (const r of validRows) {
    const acct = await prisma.gLAccount.findUnique({ where: { id: r.accountId } })
    if (!acct) continue
    const debitNormal = acct.accountClass === 'asset' || acct.accountClass === 'expense'
    // If unrealized > 0 (account gained value in CAD): asset increase → DR account, CR FX
    const u = r.unrealized
    if (debitNormal) {
      if (u > 0) jeLines.push({ glAccountId: acct.id, description: 'FX revaluation', debit: u, credit: 0 })
      else jeLines.push({ glAccountId: acct.id, description: 'FX revaluation', debit: 0, credit: -u })
    } else {
      if (u > 0) jeLines.push({ glAccountId: acct.id, description: 'FX revaluation', debit: 0, credit: u })
      else jeLines.push({ glAccountId: acct.id, description: 'FX revaluation', debit: -u, credit: 0 })
    }
    netGain += u
  }

  // Contra to FX gain account (income, credit-normal): if netGain > 0, CR FX gain; else DR FX gain
  if (netGain > 0) {
    jeLines.push({ glAccountId: fxGains.id, description: 'Unrealized FX gain', debit: 0, credit: netGain })
  } else if (netGain < 0) {
    jeLines.push({ glAccountId: fxGains.id, description: 'Unrealized FX loss', debit: -netGain, credit: 0 })
  }

  // Round-fix
  const td = jeLines.reduce((s, l) => s + l.debit, 0)
  const tc = jeLines.reduce((s, l) => s + l.credit, 0)
  const diff = Math.round((td - tc) * 100) / 100
  if (diff !== 0) {
    const last = jeLines[jeLines.length - 1]
    if (last.debit > 0) last.debit = Math.round((last.debit - diff) * 100) / 100
    else last.credit = Math.round((last.credit + diff) * 100) / 100
  }

  const je = await createJournalEntry({
    entryDate: asOf,
    description: `Unrealized FX revaluation @ ${asOf.toISOString().slice(0, 10)}`,
    memo: 'Posted from /accounting/fx-revaluation',
    status: 'posted',
    lines: jeLines,
  })

  await audit({
    entityType: 'journal_entry',
    entityId: je.id,
    action: 'post',
    summary: `FX revaluation @ ${asOf.toISOString().slice(0, 10)} · net ${netGain.toFixed(2)} CAD`,
    metadata: { asOf: asOf.toISOString(), netGain, lineCount: jeLines.length },
  })

  return Response.json({ ok: true, journalEntryId: je.id, netGain })
}
