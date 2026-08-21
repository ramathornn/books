import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export type OwnerAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string }

/**
 * Gate for user-management endpoints: a signed-in session whose CURRENT DB
 * role is 'owner'. The role is re-read from the DB (not trusted from the JWT)
 * so a demoted user loses management access immediately, not at next sign-in.
 */
export async function requireOwner(): Promise<OwnerAuthResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, status: 401, error: 'Unauthorized' }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  })
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }
  if (user.role !== 'owner') return { ok: false, status: 403, error: 'Owner access required' }
  return { ok: true, userId: user.id }
}
