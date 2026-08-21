import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { advanceDate, type IntervalUnit } from '@/lib/recurring'

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const templates = await prisma.recurringTemplate.findMany({
    orderBy: [{ isActive: 'desc' }, { nextRunDate: 'asc' }],
  })
  return Response.json({ data: templates })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const templateName = String(body.templateName || '').trim()
  const transactionType = String(body.transactionType || 'expense')
  const intervalUnit = String(body.intervalUnit || 'month') as IntervalUnit
  const intervalCount = parseInt(String(body.intervalCount || '1'), 10) || 1
  const mode = String(body.mode || 'reminder')
  const startDate = body.startDate ? new Date(String(body.startDate)) : new Date()
  const endDate = body.endDate ? new Date(String(body.endDate)) : null

  if (!templateName) return Response.json({ error: 'templateName required' }, { status: 400 })

  const t = await prisma.recurringTemplate.create({
    data: {
      templateName,
      transactionType,
      intervalUnit,
      intervalCount,
      mode,
      startDate,
      endDate,
      nextRunDate: startDate,
      payload: body.payload ?? {},
      notes: String(body.notes || ''),
      isActive: true,
    },
  })
  return Response.json(t, { status: 201 })
}
