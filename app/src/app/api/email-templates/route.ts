import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const data = await prisma.emailTemplate.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return Response.json({ data })
  } catch (error) {
    console.error('List email templates error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const text = typeof body.body === 'string' ? body.body : ''
    if (!name) {
      return Response.json({ error: 'Template name is required' }, { status: 400 })
    }
    if (!text.trim()) {
      return Response.json({ error: 'Template body is required' }, { status: 400 })
    }

    const template = await prisma.emailTemplate.create({
      data: { name, subject, body: text },
    })
    return Response.json({ data: template })
  } catch (error) {
    console.error('Create email template error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
