import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [count, user] = await Promise.all([
    prisma.authenticator.count({ where: { userId: session.user.id } }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { passkeyPromptDismissed: true },
    }),
  ])

  return Response.json({
    hasPasskey: count > 0,
    promptDismissed: user?.passkeyPromptDismissed ?? false,
  })
}
