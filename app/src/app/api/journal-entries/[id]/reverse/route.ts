import { NextRequest } from 'next/server'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { reverseJournalEntry } from '@/lib/reverseJournalEntry'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  const { id } = await params

  // Body is optional; tolerate empty / non-JSON bodies.
  let reason = ''
  try {
    const body = await request.json()
    if (body && typeof body.reason === 'string') reason = body.reason
  } catch {
    // no body — reason stays ''
  }

  try {
    const reversal = await reverseJournalEntry(id, reason)
    return Response.json(reversal)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    const code =
      error instanceof Error
        ? (error as Error & { code?: string }).code
        : undefined

    if (message === 'Journal entry not found') {
      return Response.json({ error: message }, { status: 404 })
    }
    // PERIOD_LOCKED is thrown (via assertNotLocked) when the original entryDate
    // falls in a locked period — the reversal is refused, not clamped.
    // 423 Locked, matching POST/PUT /api/journal-entries.
    if (code === 'PERIOD_LOCKED') {
      return Response.json({ error: message, code }, { status: 423 })
    }
    // Invalid-state refusals (already a reversal, not posted, etc.).
    if (
      message.includes('is a reversal') ||
      message.includes('only posted entries')
    ) {
      return Response.json({ error: message }, { status: 400 })
    }

    console.error('Reverse journal entry error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
