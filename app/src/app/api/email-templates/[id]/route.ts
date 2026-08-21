import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

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

    const template = await prisma.emailTemplate.update({
      where: { id },
      data: { name, subject, body: text },
    })
    return Response.json({ data: template })
  } catch (error) {
    console.error('Update email template error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    await prisma.emailTemplate.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Delete email template error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
