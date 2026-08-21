import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const includeArchived = sp.get('includeArchived') === '1'

  const vendors = await prisma.vendor.findMany({
    where: includeArchived ? {} : { isArchived: false },
    include: { defaultCategory: true },
    orderBy: { name: 'asc' },
  })
  return Response.json({ data: vendors })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const name = (body.name || '').toString().trim()
  if (!name) return Response.json({ error: 'Name required' }, { status: 400 })

  const existing = await prisma.vendor.findUnique({ where: { name } })
  if (existing) return Response.json(existing)

  const vendor = await prisma.vendor.create({
    data: {
      name,
      displayName: (body.displayName || '').toString(),
      contactName: (body.contactName || '').toString(),
      email: (body.email || '').toString(),
      phone: (body.phone || '').toString(),
      website: (body.website || '').toString(),
      address: (body.address || '').toString(),
      gstNumber: (body.gstNumber || '').toString(),
      defaultCategoryId: body.defaultCategoryId || null,
      defaultTaxCodeId: body.defaultTaxCodeId || null,
      defaultPayee: (body.defaultPayee || '').toString(),
      isContractor: !!body.isContractor,
    },
  })
  return Response.json(vendor, { status: 201 })
}
