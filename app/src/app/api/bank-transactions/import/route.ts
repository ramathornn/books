import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { importBankTransactions, type ImportRow } from '@/lib/bankImport'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const dryRun = sp.get('dryRun') === '1'

  const body = await request.json()
  const bankAccountId = String(body.bankAccountId || '')
  const rows: ImportRow[] = Array.isArray(body.rows) ? body.rows : []
  if (!bankAccountId) return Response.json({ error: 'bankAccountId required' }, { status: 400 })
  if (rows.length === 0) return Response.json({ error: 'rows required' }, { status: 400 })

  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } })
  if (!account) return Response.json({ error: 'Bank account not found' }, { status: 404 })

  const result = await importBankTransactions(bankAccountId, rows, { dryRun })

  if (dryRun) {
    return Response.json({
      rowsTotal: result.rowsTotal,
      rowsToImport: result.rowsToImport,
      rowsDuplicate: result.rowsDuplicate,
      rowsInvalid: result.rowsInvalid,
      rowsSkippedLocked: result.rowsSkippedLocked,
      lockedThrough: result.lockedThrough,
    })
  }

  return Response.json({
    ok: true,
    importBatchId: result.importBatchId,
    rowsInserted: result.rowsInserted,
    rowsDuplicate: result.rowsDuplicate,
    rowsInvalid: result.rowsInvalid,
    rowsSkippedLocked: result.rowsSkippedLocked,
    lockedThrough: result.lockedThrough,
  })
}
