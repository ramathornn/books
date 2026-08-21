import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { categorizeBankTransaction } from '@/lib/categorizeBankTransaction'
import { getOrCreateVendorForMerchant, learnVendorAlias } from '@/lib/vendorResolve'
import { loadOwnOrgNames } from '@/lib/documentIntake'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json()

  // Read the STORED descriptors before applying — the alias must learn the raw
  // bank strings, not the drawer's (possibly human-edited) payee value.
  const stored = await prisma.bankTransaction.findUnique({
    where: { id },
    select: { payee: true, description: true },
  })

  // "Create vendor X" affordance: get-or-create the vendor (guarded) and use it.
  let vendorId: string | null = body.vendorId || null
  if (body.createVendorName) {
    vendorId =
      (await getOrCreateVendorForMerchant(String(body.createVendorName), {
        ownOrgNames: await loadOwnOrgNames(),
        source: 'confirm',
      })) || vendorId
  }

  const result = await categorizeBankTransaction(id, {
    categoryGlAccountId: String(body.categoryGlAccountId || ''),
    taxCodeId: body.taxCodeId,
    hasTaxCodeKey: 'taxCodeId' in body,
    vendorId,
    memo: body.memo,
    payee: body.payee,
  })

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  // A confirmed vendor pick is ground truth — learn both stored descriptors so the
  // same bank string resolves via the alias tier next time (each guarded/skipped).
  if (vendorId && stored) {
    await learnVendorAlias(stored.payee, vendorId, 'confirm')
    await learnVendorAlias(stored.description, vendorId, 'confirm')
  }

  return Response.json({ ok: true, journalEntryId: result.journalEntryId })
}
