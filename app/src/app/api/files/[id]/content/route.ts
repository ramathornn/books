import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { absolutePath, INLINE_MIME } from '@/lib/files'
import fs from 'node:fs/promises'

// GET /api/files/[id]/content — stream the bytes, auth-gated and by DB id only.
// Active content is never served inline: anything outside INLINE_MIME downloads
// as an attachment, and nosniff stops the browser from re-interpreting the type.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })
  const { id } = await params

  const file = await prisma.storedFile.findUnique({ where: { id } })
  if (!file) return new Response('Not found', { status: 404 })

  // ?download=1 forces a download even for inline-capable types.
  const forceDownload = request.nextUrl.searchParams.get('download') === '1'
  const disposition = !forceDownload && INLINE_MIME.has(file.mimeType) ? 'inline' : 'attachment'
  const safeName = file.name.replace(/["\\\r\n]/g, '_')

  try {
    const buf = await fs.readFile(absolutePath(file.storagePath))
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${safeName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return new Response('File missing on disk', { status: 410 })
  }
}
