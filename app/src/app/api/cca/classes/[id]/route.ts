import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

/**
 * A single CCA class.
 *
 *   PATCH /api/cca/classes/[id]   → edit class config (rate, accounts, flags)
 *
 * Note: changing `rate`/flags affects only OPEN-year recompute; locked years
 * keep their stored ccaRate and `filed*` snapshot untouched.
 */

function parseRate(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  if (!Number.isFinite(n)) return null
  const rate = n > 1 ? n / 100 : n
  if (rate <= 0 || rate > 1) return null
  return Math.round(rate * 10000) / 10000
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await prisma.ccaClass.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'Class not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const data: Prisma.CcaClassUpdateInput = {}

  if (body.description !== undefined) data.description = String(body.description).trim()
  if (body.rate !== undefined) {
    const rate = parseRate(body.rate)
    if (rate === null) return Response.json({ error: 'invalid rate' }, { status: 400 })
    data.rate = new Prisma.Decimal(rate)
  }
  if (body.halfYearRuleApplies !== undefined) data.halfYearRuleApplies = !!body.halfYearRuleApplies
  if (body.accIiEligible !== undefined) data.accIiEligible = !!body.accIiEligible
  if (body.immediateExpensingEligible !== undefined) data.immediateExpensingEligible = !!body.immediateExpensingEligible
  if (body.expenseAccountId !== undefined) data.expenseAccountId = body.expenseAccountId || null
  if (body.accumDepAccountId !== undefined) data.accumDepAccountId = body.accumDepAccountId || null
  if (body.assetAccountId !== undefined) data.assetAccountId = body.assetAccountId || null
  if (body.isArchived !== undefined) data.isArchived = !!body.isArchived

  await prisma.ccaClass.update({ where: { id }, data })
  return Response.json({ ok: true })
}
