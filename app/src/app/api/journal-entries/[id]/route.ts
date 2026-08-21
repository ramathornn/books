import { NextRequest } from 'next/server'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import prisma from '@/lib/prisma'
import { journalEntrySchema } from '@/lib/validators'
import { updateJournalEntry } from '@/lib/journalEntry'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  const { id } = await context.params
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: { include: { glAccount: true }, orderBy: { sortOrder: 'asc' } } },
  })
  if (!entry) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(entry)
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  const { id } = await context.params

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
    const je = await updateJournalEntry(id, {
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
    return Response.json(entry)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update journal entry'
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
    if (message === 'Journal entry not found') {
      return Response.json({ error: message }, { status: 404 })
    }
    if (code === 'PERIOD_LOCKED') {
      return Response.json({ error: message, code }, { status: 423 })
    }
    if (message.includes('Only draft entries') || message.includes('must be balanced')) {
      return Response.json({ error: message }, { status: 400 })
    }
    console.error('Update journal entry error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  const { id } = await context.params

  const current = await prisma.journalEntry.findUnique({ where: { id } })
  if (!current) return Response.json({ error: 'Not found' }, { status: 404 })
  if (current.status === 'posted') {
    return Response.json({ error: 'Posted entries cannot be deleted; void instead' }, { status: 400 })
  }

  // Drafts have never touched GL balances, so deletion needs no balance work
  // and no period-lock check.
  await prisma.journalEntry.delete({ where: { id } })
  return Response.json({ ok: true })
}
