import { NextRequest } from 'next/server'
import { CountryCode } from 'plaid'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { plaid } from '@/lib/plaid'
import { encryptSecret } from '@/lib/crypto'

// Exchange the Link public_token for an access_token, persist the Item (token
// encrypted at rest), and return the institution's accounts so the UI can map
// each to an existing bank account.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!plaid) return Response.json({ error: 'Plaid not configured' }, { status: 503 })

  const body = await request.json().catch(() => ({}))
  const publicToken = String(body.publicToken || '')
  if (!publicToken) return Response.json({ error: 'publicToken required' }, { status: 400 })

  try {
    const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken })
    const accessToken = exchange.data.access_token
    const itemId = exchange.data.item_id

    const accountsRes = await plaid.accountsGet({ access_token: accessToken })
    const institutionId = accountsRes.data.item.institution_id || ''
    let institutionName = ''
    if (institutionId) {
      try {
        const inst = await plaid.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Ca, CountryCode.Us],
        })
        institutionName = inst.data.institution.name
      } catch {
        /* institution lookup is best-effort */
      }
    }

    const item = await prisma.plaidItem.upsert({
      where: { itemId },
      create: {
        itemId,
        institutionId,
        institutionName,
        accessTokenEnc: encryptSecret(accessToken),
        status: 'active',
      },
      update: {
        institutionId,
        institutionName,
        accessTokenEnc: encryptSecret(accessToken),
        status: 'active',
        lastError: null,
      },
    })

    return Response.json({
      itemId: item.id,
      institutionName,
      accounts: accountsRes.data.accounts.map((a) => ({
        accountId: a.account_id,
        name: a.name,
        officialName: a.official_name || '',
        mask: a.mask || '',
        type: String(a.type || ''),
        subtype: String(a.subtype || ''),
        currency: a.balances.iso_currency_code || '',
      })),
    })
  } catch (err) {
    const detail =
      (err as { response?: { data?: unknown } })?.response?.data ||
      (err instanceof Error ? err.message : 'exchange failed')
    console.error('[plaid exchange]', detail)
    return Response.json({ error: 'Could not connect the institution', detail }, { status: 502 })
  }
}
