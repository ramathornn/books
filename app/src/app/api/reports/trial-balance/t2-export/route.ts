import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { formatCsv } from '@/lib/csv'
import { resolveReportRange } from '@/lib/reportRange'
import { parseCurrencyParam, defaultGLAccountCurrency } from '@/lib/reportCurrency'
import { balancesAsOf, parseAsOfParam } from '@/lib/glBalances'

/**
 * "Export for T2" — emits the trial balance as CSV keyed by GIFI code, ready to
 * load into TaxCycle / ProFile for a T2 corporate return.
 *
 * Columns: Account #, Account Name, GIFI Code, Debit, Credit. Accounts missing a
 * GIFI code are still exported (blank GIFI) so the accountant can spot and map
 * them. Mirrors the Trial Balance page's currency + as-of logic exactly so the
 * numbers tie out to what's on screen.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const preset = sp.get('preset') || 'last-month'
  const currency =
    parseCurrencyParam({ currency: sp.get('currency') ?? undefined }) ||
    (await defaultGLAccountCurrency())

  const asOfRaw = sp.get('asOf')
  const end = asOfRaw ? parseAsOfParam(asOfRaw) : resolveReportRange(preset).end

  const accounts = await prisma.gLAccount.findMany({
    where: { isArchived: false, currency },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
  })

  const balances = await balancesAsOf(accounts, end)

  const rows = accounts
    .map((a) => {
      const bal = balances.get(a.id) || 0
      const isDebitNormal = a.accountClass === 'asset' || a.accountClass === 'expense'
      return {
        accountNumber: a.accountNumber,
        accountName: a.accountName,
        gifiCode: a.gifiCode || '',
        debit: isDebitNormal ? Math.max(0, bal) : Math.max(0, -bal),
        credit: isDebitNormal ? Math.max(0, -bal) : Math.max(0, bal),
      }
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)

  const headers = ['Account #', 'Account Name', 'GIFI Code', 'Debit', 'Credit']
  const csvRows = rows.map((r) => [
    r.accountNumber,
    r.accountName,
    r.gifiCode,
    r.debit ? r.debit.toFixed(2) : '',
    r.credit ? r.credit.toFixed(2) : '',
  ])

  const csv = formatCsv(headers, csvRows)
  const asOfLabel = end.toISOString().slice(0, 10)
  const filename = `trial-balance-t2-${currency}-${asOfLabel}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
