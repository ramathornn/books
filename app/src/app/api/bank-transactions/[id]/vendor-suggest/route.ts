import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { loadVendorIndex, suggestVendorForTx } from '@/lib/vendorResolve'

/**
 * Suggest a vendor for a pending bank transaction (suggest-first HITL). GET,
 * session-auth (called from a logged-in session, so no proxy.ts allow-list
 * change). Never writes. Returns the VendorMatch, plus — on a confident match —
 * the matched vendor's default GL category so the drawer can preselect both and
 * turn a recurring merchant into a one-click confirm.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const tx = await prisma.bankTransaction.findUnique({
    where: { id },
    select: { payee: true, description: true },
  })
  if (!tx) return Response.json({ error: 'Not found' }, { status: 404 })

  const index = await loadVendorIndex()
  const match = suggestVendorForTx(tx.payee, tx.description, index)

  // On a confident vendor, look up its default expense category's GL account so
  // the drawer can preselect the category too (nullable — omitted when unset).
  let defaultCategoryGlAccountId: string | null = null
  if (match.vendorId) {
    const v = await prisma.vendor.findUnique({
      where: { id: match.vendorId },
      select: { defaultCategory: { select: { glAccountId: true } } },
    })
    defaultCategoryGlAccountId = v?.defaultCategory?.glAccountId ?? null
  }

  return Response.json({ ...match, defaultCategoryGlAccountId })
}
