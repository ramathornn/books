import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALLOWED_ROLES = new Set(['owner', 'admin', 'employee'])

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
    const existing = await prisma.teamMember.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Team member not found' }, { status: 404 })
    }

    const body = await request.json()
    const data: {
      firstName?: string
      lastName?: string
      email?: string
      jobTitle?: string | null
      role?: string
    } = {}
    const fieldErrors: Record<string, string> = {}

    if (body?.firstName !== undefined) {
      const v = typeof body.firstName === 'string' ? body.firstName.trim() : ''
      if (!v) fieldErrors.firstName = 'First name is required'
      else if (v.length > 100) fieldErrors.firstName = 'First name is too long'
      else data.firstName = v
    }
    if (body?.lastName !== undefined) {
      const v = typeof body.lastName === 'string' ? body.lastName.trim() : ''
      if (!v) fieldErrors.lastName = 'Last name is required'
      else if (v.length > 100) fieldErrors.lastName = 'Last name is too long'
      else data.lastName = v
    }
    if (body?.email !== undefined) {
      const v = typeof body.email === 'string' ? body.email.trim() : ''
      if (!v) fieldErrors.email = 'Email is required'
      else if (!EMAIL_REGEX.test(v)) fieldErrors.email = 'Invalid email address'
      else data.email = v
    }
    if (body?.jobTitle !== undefined) {
      if (body.jobTitle === null) {
        data.jobTitle = null
      } else if (typeof body.jobTitle === 'string') {
        const v = body.jobTitle.trim()
        data.jobTitle = v.length > 0 ? v : null
      }
    }
    if (body?.role !== undefined) {
      const v = typeof body.role === 'string' ? body.role : ''
      if (!ALLOWED_ROLES.has(v)) fieldErrors.role = 'Invalid role'
      else data.role = v
    }

    if (Object.keys(fieldErrors).length > 0) {
      return Response.json(
        { error: 'Validation failed', details: fieldErrors },
        { status: 400 }
      )
    }

    if (data.email && data.email !== existing.email) {
      const dupe = await prisma.teamMember.findUnique({ where: { email: data.email } })
      if (dupe) {
        return Response.json(
          { error: 'A team member with this email already exists' },
          { status: 409 }
        )
      }
    }

    const teamMember = await prisma.teamMember.update({
      where: { id },
      data,
    })

    return Response.json(teamMember)
  } catch (error) {
    console.error('Update team member error:', error)
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
    const existing = await prisma.teamMember.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Team member not found' }, { status: 404 })
    }

    await prisma.teamMember.update({
      where: { id },
      data: { status: 'deleted' },
    })

    return Response.json({ success: true })
  } catch (error) {
    console.error('Delete team member error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
