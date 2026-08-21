import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

/**
 * CCA classes — setup CRUD.
 *
 *   GET  /api/cca/classes          → all classes (with asset + schedule counts)
 *   POST /api/cca/classes          → create a class
 */

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const classes = await prisma.ccaClass.findMany({
    orderBy: { classNumber: 'asc' },
    include: {
      _count: { select: { assets: true, scheduleEntries: true } },
    },
  })

  return Response.json({
    classes: classes.map((c) => ({
      id: c.id,
      classNumber: c.classNumber,
      description: c.description,
      rate: Number(c.rate),
      halfYearRuleApplies: c.halfYearRuleApplies,
      accIiEligible: c.accIiEligible,
      immediateExpensingEligible: c.immediateExpensingEligible,
      expenseAccountId: c.expenseAccountId,
      accumDepAccountId: c.accumDepAccountId,
      assetAccountId: c.assetAccountId,
      isArchived: c.isArchived,
      assetCount: c._count.assets,
      yearCount: c._count.scheduleEntries,
    })),
  })
}

function parseRate(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  if (!Number.isFinite(n)) return null
  // Accept either fraction (0.30) or percent (30) — normalise to fraction.
  const rate = n > 1 ? n / 100 : n
  if (rate <= 0 || rate > 1) return null
  return Math.round(rate * 10000) / 10000
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const classNumber = String(body.classNumber ?? '').trim()
  const description = String(body.description ?? '').trim()
  const rate = parseRate(body.rate)

  if (!classNumber) return Response.json({ error: 'classNumber required' }, { status: 400 })
  if (!description) return Response.json({ error: 'description required' }, { status: 400 })
  if (rate === null) return Response.json({ error: 'rate must be a fraction (0-1) or percent (0-100)' }, { status: 400 })

  try {
    const created = await prisma.ccaClass.create({
      data: {
        classNumber,
        description,
        rate: new Prisma.Decimal(rate),
        halfYearRuleApplies: body.halfYearRuleApplies ?? true,
        accIiEligible: body.accIiEligible ?? false,
        immediateExpensingEligible: body.immediateExpensingEligible ?? false,
        expenseAccountId: body.expenseAccountId || null,
        accumDepAccountId: body.accumDepAccountId || null,
        assetAccountId: body.assetAccountId || null,
      },
    })
    return Response.json({ ok: true, id: created.id })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return Response.json({ error: `Class ${classNumber} already exists.` }, { status: 409 })
    }
    throw e
  }
}
