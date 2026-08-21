import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const teamMembers = await prisma.teamMember.findMany({
    where: { status: 'active' },
    orderBy: { firstName: 'asc' },
  })

  return Response.json({ teamMembers })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : ''
    const lastName = typeof body?.lastName === 'string' ? body.lastName.trim() : ''
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const jobTitle =
      typeof body?.jobTitle === 'string' && body.jobTitle.trim().length > 0
        ? body.jobTitle.trim()
        : null

    const fieldErrors: Record<string, string> = {}
    if (!firstName) fieldErrors.firstName = 'First name is required'
    else if (firstName.length > 100) fieldErrors.firstName = 'First name is too long'
    if (!lastName) fieldErrors.lastName = 'Last name is required'
    else if (lastName.length > 100) fieldErrors.lastName = 'Last name is too long'
    if (!email) fieldErrors.email = 'Email is required'
    else if (!EMAIL_REGEX.test(email)) fieldErrors.email = 'Invalid email address'

    if (Object.keys(fieldErrors).length > 0) {
      return Response.json(
        { error: 'Validation failed', details: fieldErrors },
        { status: 400 }
      )
    }

    const existing = await prisma.teamMember.findUnique({ where: { email } })
    if (existing) {
      return Response.json(
        { error: 'A team member with this email already exists' },
        { status: 409 }
      )
    }

    const teamMember = await prisma.teamMember.create({
      data: {
        firstName,
        lastName,
        email,
        jobTitle,
        role: 'employee',
        status: 'active',
      },
    })

    return Response.json(teamMember, { status: 201 })
  } catch (error) {
    console.error('Create team member error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
