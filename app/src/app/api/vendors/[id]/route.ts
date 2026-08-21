import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: { defaultCategory: true, expenses: { take: 5, orderBy: { date: 'desc' } } },
  })
  if (!vendor) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(vendor)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json()
  const name = (body.name || '').toString().trim()
  if (!name) return Response.json({ error: 'Name required' }, { status: 400 })

  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      name,
      displayName: (body.displayName ?? '').toString(),
      contactName: (body.contactName ?? '').toString(),
      email: (body.email ?? '').toString(),
      phone: (body.phone ?? '').toString(),
      website: (body.website ?? '').toString(),
      address: (body.address ?? '').toString(),
      gstNumber: (body.gstNumber ?? '').toString(),
      defaultCategoryId: body.defaultCategoryId || null,
      defaultTaxCodeId: body.defaultTaxCodeId || null,
      defaultPayee: (body.defaultPayee ?? '').toString(),
      isContractor: !!body.isContractor,
      isArchived: !!body.isArchived,
    },
  })
  return Response.json(vendor)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  // Soft delete (archive) if there are linked expenses; hard delete if none
  const linked = await prisma.expense.count({ where: { vendorId: id } })
  if (linked > 0) {
    await prisma.vendor.update({ where: { id }, data: { isArchived: true } })
    return Response.json({ archived: true })
  }
  await prisma.vendor.delete({ where: { id } })
  return Response.json({ deleted: true })
}
