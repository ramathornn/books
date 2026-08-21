import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { projectSchema } from '@/lib/validators'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const clientId = sp.get('clientId')
  const where: Record<string, unknown> = { isArchived: false }
  if (clientId) where.clientId = clientId

  const projects = await prisma.project.findMany({
    where,
    include: { client: { select: { id: true, firstName: true, lastName: true, organization: true } } },
    orderBy: { name: 'asc' },
  })
  return Response.json({ data: projects })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = projectSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      clientId: parsed.data.clientId || null,
      hourlyRate: parsed.data.hourlyRate ?? undefined,
      currency: parsed.data.currency,
    },
  })
  return Response.json(project, { status: 201 })
}
