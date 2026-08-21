import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { expenseCategorySchema } from '@/lib/validators'

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const categories = await prisma.expenseCategory.findMany({
    where: { isArchived: false },
    include: { parent: true, glAccount: true },
    orderBy: [{ groupName: 'asc' }, { name: 'asc' }],
  })
  return Response.json({ data: categories })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = expenseCategorySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const c = await prisma.expenseCategory.create({ data: parsed.data })
  return Response.json(c, { status: 201 })
}
