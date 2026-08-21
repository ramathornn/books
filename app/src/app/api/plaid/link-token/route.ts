import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { CountryCode, Products } from 'plaid'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { plaid } from '@/lib/plaid'
import { decryptSecret } from '@/lib/crypto'

function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

// Create a Plaid Link token. Pass { itemId } to re-authenticate an existing
// connection (update mode) when it goes into login_required.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!plaid) return Response.json({ error: 'Plaid not configured' }, { status: 503 })

  const body = await request.json().catch(() => ({}))
  const updateItemDbId = body.itemId ? String(body.itemId) : ''

  let accessToken: string | undefined
  if (updateItemDbId) {
    const item = await prisma.plaidItem.findUnique({ where: { id: updateItemDbId } })
    if (item) accessToken = decryptSecret(item.accessTokenEnc)
  }

  // Plaid rejects PII (e.g. an email) as client_user_id, so use a stable hash.
  const userKey = session.user.email || session.user.name || 'ugo-media'
  const clientUserId = crypto.createHash('sha256').update(userKey).digest('hex').slice(0, 40)

  const base = baseUrl()
  try {
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: clientUserId },
      client_name: 'Books',
      // Update mode (access_token present) must omit products.
      products: accessToken ? [] : [Products.Transactions],
      country_codes: [CountryCode.Ca, CountryCode.Us],
      language: 'en',
      webhook: `${base}/api/plaid/webhook`,
      redirect_uri: `${base}/banking`,
      transactions: { days_requested: 730 },
      ...(accessToken ? { access_token: accessToken } : {}),
    })
    return Response.json({ linkToken: res.data.link_token })
  } catch (err) {
    const detail =
      (err as { response?: { data?: unknown } })?.response?.data ||
      (err instanceof Error ? err.message : 'link_token failed')
    console.error('[plaid link-token]', detail)
    return Response.json({ error: 'Could not start Plaid Link', detail }, { status: 502 })
  }
}
