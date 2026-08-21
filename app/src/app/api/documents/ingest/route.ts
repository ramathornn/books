import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { MAX_FILE_SIZE } from '@/lib/attachments'
import { ingestDocument } from '@/lib/documentIntake'

// Drop a document → OCR → match to its posted expense JE → attach, or return
// ranked candidates for a one-click confirm. Never auto-attaches on a guess.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'file required' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await ingestDocument({ originalName: file.name, mimeType: file.type, buffer })
  return Response.json(result)
}
