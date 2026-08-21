import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { generatePdf, EstimatePdfData } from '@/lib/pdf'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const token = request.nextUrl.searchParams.get('token')

  let estimate

  if (token) {
    // Public access via share token
    estimate = await prisma.estimate.findFirst({
      where: { id, shareToken: token },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })
  } else {
    // Dashboard access - requires auth
    const session = await auth()
    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    estimate = await prisma.estimate.findUnique({
      where: { id },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })
  }

  if (!estimate) {
    return new Response('Estimate not found', { status: 404 })
  }

  const clientName = [estimate.client.firstName, estimate.client.lastName]
    .filter(Boolean)
    .join(' ')

  const pdfData: EstimatePdfData = {
    type: 'estimate',
    estimateNumber: estimate.estimateNumber,
    dateIssued: estimate.dateIssued,
    currency: estimate.currency || 'CAD',
    subtotal: Number(estimate.subtotal),
    taxTotal: Number(estimate.taxTotal),
    total: Number(estimate.total),
    notes: estimate.notes || undefined,
    client: {
      clientName: clientName || undefined,
      organization: estimate.client.organization || undefined,
      address: estimate.client.address || undefined,
      vatId: estimate.client.vatId || undefined,
    },
    lineItems: estimate.lineItems.map((item) => ({
      title: item.title,
      description: item.description,
      rate: Number(item.rate),
      quantity: Number(item.quantity),
      lineTotal: Number(item.lineTotal),
      taxCodes: item.taxCodes,
    })),
  }

  const pdfBuffer = await generatePdf(pdfData)
  const uint8 = new Uint8Array(pdfBuffer)

  return new Response(uint8, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Estimate_${estimate.estimateNumber}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    },
  })
}
