import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const result = await prisma.authenticator.deleteMany({
    where: { id, userId: session.user.id },
  })

  if (result.count === 0) {
    return Response.json({ error: 'Passkey not found.' }, { status: 404 })
  }

  return Response.json({ success: true })
}
