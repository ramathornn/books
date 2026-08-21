import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const favs = await prisma.favoriteReport.findMany({ orderBy: { createdAt: 'asc' } })
  return Response.json({ data: favs.map((f) => f.reportKey) })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const key = (body.reportKey || '').toString()
  if (!key) return Response.json({ error: 'reportKey required' }, { status: 400 })
  const existing = await prisma.favoriteReport.findUnique({ where: { reportKey: key } })
  if (existing) {
    await prisma.favoriteReport.delete({ where: { reportKey: key } })
    return Response.json({ favorited: false })
  }
  await prisma.favoriteReport.create({ data: { reportKey: key } })
  return Response.json({ favorited: true })
}
