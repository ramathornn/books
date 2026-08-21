import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { passkeyPromptDismissed: true },
  })

  return Response.json({ success: true })
}
