import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { encryptSin, isValidSin, sinLast3 } from '@/lib/tax/sin'

/**
 * Tax recipients (TaxParty) collection.
 *
 *   GET  /api/tax/parties?q=&kind=        → list (masked; never plaintext SIN)
 *   POST /api/tax/parties { kind, ... }    → create a recipient
 *
 * SIN handling: the raw SIN is accepted on create, validated (Luhn) and
 * encrypted at rest (AES-GCM via @/lib/tax/sin); only `sinLast3` is kept in the
 * clear for display masking. The cipher is never returned to the client.
 */

function selectMasked() {
  return {
    id: true,
    kind: true,
    firstName: true,
    lastName: true,
    businessName: true,
    sinLast3: true,
    businessNumber: true,
    addressLine1: true,
    addressLine2: true,
    city: true,
    province: true,
    postalCode: true,
    country: true,
    email: true,
    phone: true,
    clientId: true,
    vendorId: true,
    isArchived: true,
  } as const
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim()
  const kind = url.searchParams.get('kind') || ''
  const includeArchived = url.searchParams.get('includeArchived') === '1'

  const parties = await prisma.taxParty.findMany({
    where: {
      ...(includeArchived ? {} : { isArchived: false }),
      ...(kind === 'individual' || kind === 'business' ? { kind } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { businessName: { contains: q, mode: 'insensitive' } },
              { businessNumber: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: selectMasked(),
    orderBy: [{ businessName: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    take: 200,
  })
  return Response.json({ parties })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const kind = body.kind === 'business' ? 'business' : 'individual'

  const sinRaw = String(body.sin ?? '').trim()
  let sinCipher: string | null = null
  let last3: string | null = null
  if (sinRaw) {
    if (!isValidSin(sinRaw)) {
      return Response.json({ error: 'Invalid SIN (failed checksum / length).' }, { status: 400 })
    }
    sinCipher = encryptSin(sinRaw)
    last3 = sinLast3(sinRaw)
  }

  const businessNumber = String(body.businessNumber ?? '').replace(/\s/g, '').toUpperCase() || null

  if (kind === 'individual' && !sinCipher && !businessNumber) {
    // Allow saving without a SIN (draft recipient), but warn the UI via field.
  }
  if (kind === 'business' && !businessNumber) {
    return Response.json({ error: 'A business recipient requires a Business Number.' }, { status: 400 })
  }

  const created = await prisma.taxParty.create({
    data: {
      kind,
      firstName: String(body.firstName ?? ''),
      lastName: String(body.lastName ?? ''),
      businessName: String(body.businessName ?? ''),
      sinCipher,
      sinLast3: last3,
      businessNumber,
      addressLine1: String(body.addressLine1 ?? ''),
      addressLine2: String(body.addressLine2 ?? ''),
      city: String(body.city ?? ''),
      province: String(body.province ?? ''),
      postalCode: String(body.postalCode ?? ''),
      country: String(body.country ?? 'CA') || 'CA',
      email: String(body.email ?? ''),
      phone: String(body.phone ?? ''),
      clientId: body.clientId ? String(body.clientId) : null,
      vendorId: body.vendorId ? String(body.vendorId) : null,
    },
    select: selectMasked(),
  })

  await audit({ entityType: 'tax_return', entityId: created.id, action: 'create', summary: `Tax recipient created` })
  return Response.json({ party: created }, { status: 201 })
}
