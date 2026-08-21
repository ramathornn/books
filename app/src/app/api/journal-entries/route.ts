import { NextRequest } from 'next/server'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import prisma from '@/lib/prisma'
import { journalEntrySchema } from '@/lib/validators'
import { createJournalEntry } from '@/lib/journalEntry'

export async function GET(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) return Response.json({ error: 'Unauthorized' }, { status: authed.status })

  const sp = request.nextUrl.searchParams
  const status = sp.get('status')
  const from = sp.get('from')
  const to = sp.get('to')
  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (from || to) {
    const df: Record<string, Date> = {}
    if (from) df.gte = new Date(from)
    if (to) df.lte = new Date(to)
    where.entryDate = df
  }

  const entries = await prisma.journalEntry.findMany({
    where,
    include: { lines: { include: { glAccount: true }, orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
  })
  return Response.json({ data: entries })
}

export async function POST(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) return Response.json({ error: 'Unauthorized' }, { status: authed.status })

  const body = await request.json().catch(() => null)
  const parsed = journalEntrySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const d = parsed.data
  const entryDate = d.entryDate instanceof Date ? d.entryDate : new Date(d.entryDate)
  if (Number.isNaN(entryDate.getTime())) {
    return Response.json({ error: 'Invalid entryDate' }, { status: 400 })
  }

  try {
    const je = await createJournalEntry({
      entryDate,
      description: d.description,
      memo: d.memo,
      status: d.status,
      lines: d.lines.map((l) => ({
        glAccountId: l.glAccountId,
        description: l.description,
        debit: l.debit || 0,
        credit: l.credit || 0,
      })),
    })
    const entry = await prisma.journalEntry.findUnique({
      where: { id: je.id },
      include: { lines: { include: { glAccount: true }, orderBy: { sortOrder: 'asc' } } },
    })
    return Response.json(entry, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create journal entry'
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
    if (code === 'PERIOD_LOCKED') {
      return Response.json({ error: message, code }, { status: 423 })
    }
    if (message.includes('must be balanced') || message.includes('not found')) {
      return Response.json({ error: message }, { status: 400 })
    }
    console.error('Create journal entry error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
