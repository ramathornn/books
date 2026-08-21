import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { formatInvoiceNumber } from '@/lib/utils'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lastEstimate = await prisma.estimate.findFirst({
    orderBy: { estimateNumber: 'desc' },
    select: { estimateNumber: true },
  })

  const nextNum = lastEstimate
    ? parseInt(lastEstimate.estimateNumber, 10) + 1
    : 1

  return Response.json({ nextNumber: formatInvoiceNumber(nextNum) })
}
