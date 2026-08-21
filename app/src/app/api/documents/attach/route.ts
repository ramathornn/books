import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { MAX_FILE_SIZE } from '@/lib/attachments'
import { attachDocumentToJE } from '@/lib/documentIntake'

// Confirm step: attach an uploaded document to the journal entry the user picked
// from the candidates returned by /api/documents/ingest.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  const journalEntryId = String(form.get('journalEntryId') || '')
  if (!(file instanceof File)) return Response.json({ error: 'file required' }, { status: 400 })
  if (!journalEntryId) return Response.json({ error: 'journalEntryId required' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  await attachDocumentToJE(journalEntryId, { originalName: file.name, mimeType: file.type, buffer })
  return Response.json({ ok: true })
}
