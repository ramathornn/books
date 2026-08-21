import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  let body: { enabled?: boolean; saveAsDefault?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const enabled = !!body.enabled
  const saveAsDefault = !!body.saveAsDefault

  const invoice = await prisma.invoice.update({
    where: { id },
    data: { onlinePaymentsEnabled: enabled },
    select: { id: true, onlinePaymentsEnabled: true },
  })

  if (saveAsDefault && session.user.email) {
    await prisma.user.update({
      where: { email: session.user.email },
      data: { defaultOnlinePaymentsEnabled: enabled },
    })
  }

  return NextResponse.json(invoice)
}
