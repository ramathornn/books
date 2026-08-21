import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { serviceSchema } from '@/lib/validators'

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const services = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  })
  return Response.json({ data: services })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = serviceSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const service = await prisma.service.create({ data: parsed.data })
  return Response.json(service, { status: 201 })
}
