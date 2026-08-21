import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { encryptSin, isValidSin, sinLast3 } from '@/lib/tax/sin'

/**
 * Single tax recipient (TaxParty).
 *   GET    → masked party (never plaintext SIN cipher)
 *   PATCH  → update fields; a new `sin` replaces the cipher (re-encrypted)
 *   DELETE → archive (soft) — blocked when non-draft slips reference the party
 *            (design finding #9: historical slips read frozen snapshots, but the
 *            live party must not vanish while issued slips point at it).
 */

function selectMasked() {
  return {
    id: true, kind: true, firstName: true, lastName: true, businessName: true,
    sinLast3: true, businessNumber: true, addressLine1: true, addressLine2: true,
    city: true, province: true, postalCode: true, country: true, email: true,
    phone: true, clientId: true, vendorId: true, isArchived: true,
  } as const
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const party = await prisma.taxParty.findUnique({ where: { id }, select: selectMasked() })
  if (!party) return Response.json({ error: 'Recipient not found' }, { status: 404 })
  return Response.json({ party })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await prisma.taxParty.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'Recipient not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  const stringFields = [
    'firstName', 'lastName', 'businessName', 'addressLine1', 'addressLine2',
    'city', 'province', 'postalCode', 'country', 'email', 'phone',
  ]
  for (const f of stringFields) if (body[f] !== undefined) data[f] = String(body[f] ?? '')
  if (body.kind === 'individual' || body.kind === 'business') data.kind = body.kind
  if (body.businessNumber !== undefined) {
    data.businessNumber = String(body.businessNumber ?? '').replace(/\s/g, '').toUpperCase() || null
  }
  if (body.clientId !== undefined) data.clientId = body.clientId ? String(body.clientId) : null
  if (body.vendorId !== undefined) data.vendorId = body.vendorId ? String(body.vendorId) : null

  // A non-empty `sin` replaces the cipher; empty/undefined leaves it untouched.
  const sinRaw = body.sin !== undefined ? String(body.sin ?? '').trim() : ''
  if (sinRaw) {
    if (!isValidSin(sinRaw)) return Response.json({ error: 'Invalid SIN (failed checksum / length).' }, { status: 400 })
    data.sinCipher = encryptSin(sinRaw)
    data.sinLast3 = sinLast3(sinRaw)
  }

  const updated = await prisma.taxParty.update({ where: { id }, data, select: selectMasked() })
  await audit({ entityType: 'tax_return', entityId: id, action: 'update', summary: 'Tax recipient updated' })
  return Response.json({ party: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await prisma.taxParty.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'Recipient not found' }, { status: 404 })

  // Block archive while non-draft slips reference the party (finding #9).
  const nonDraft = await prisma.taxSlip.count({ where: { partyId: id, status: { not: 'draft' } } })
  if (nonDraft > 0) {
    return Response.json(
      { error: `Cannot archive: ${nonDraft} issued/filed slip(s) reference this recipient.` },
      { status: 409 }
    )
  }

  const archived = await prisma.taxParty.update({
    where: { id },
    data: { isArchived: true },
    select: selectMasked(),
  })
  await audit({ entityType: 'tax_return', entityId: id, action: 'archive', summary: 'Tax recipient archived' })
  return Response.json({ party: archived })
}
