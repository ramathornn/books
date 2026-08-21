import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { jwtVerify, importJWK, decodeProtectedHeader, type JWK } from 'jose'
import prisma from '@/lib/prisma'
import { plaid } from '@/lib/plaid'
import { syncPlaidItem } from '@/lib/plaidSync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Verify the Plaid webhook per their spec: the `plaid-verification` header is an
// ES256 JWT whose key is fetched from /webhook_verification_key/get by `kid`;
// the JWT carries `request_body_sha256` which must match the raw body. A 5-min
// max age guards against replay.
async function verifyWebhook(token: string, rawBody: string): Promise<boolean> {
  if (!plaid) return false
  try {
    const header = decodeProtectedHeader(token) as { kid?: string; alg?: string }
    if (!header.kid || header.alg !== 'ES256') return false

    const keyRes = await plaid.webhookVerificationKeyGet({ key_id: header.kid })
    const key = await importJWK(keyRes.data.key as unknown as JWK, 'ES256')

    const { payload } = await jwtVerify(token, key, {
      algorithms: ['ES256'],
      maxTokenAge: '5 min',
    })
    const expected = payload['request_body_sha256']
    if (typeof expected !== 'string') return false

    const actual = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(actual)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch (err) {
    console.error('[plaid webhook] verification failed', err)
    return false
  }
}

export async function POST(request: NextRequest) {
  const token = request.headers.get('plaid-verification') || ''
  const rawBody = await request.text()

  if (!token || !(await verifyWebhook(token, rawBody))) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { webhook_type?: string; webhook_code?: string; item_id?: string; error?: unknown }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 })
  }

  const plaidItemId = String(body.item_id || '')
  if (plaidItemId) {
    const item = await prisma.plaidItem.findUnique({ where: { itemId: plaidItemId } })
    if (item) {
      if (body.webhook_type === 'TRANSACTIONS') {
        try {
          await syncPlaidItem(item.id)
        } catch (err) {
          console.error('[plaid webhook] sync failed', err)
        }
      } else if (body.webhook_type === 'ITEM' && body.error) {
        const code = (body.error as { error_code?: string })?.error_code || 'error'
        await prisma.plaidItem.update({
          where: { id: item.id },
          data: {
            status: code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error',
            lastError: String(code).slice(0, 300),
          },
        })
      }
    }
  }

  // Always 200 so Plaid doesn't retry endlessly on events we don't act on.
  return Response.json({ ok: true })
}
