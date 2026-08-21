import { NextRequest } from 'next/server'
import JSZip from 'jszip'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { generatePdf, EstimatePdfData } from '@/lib/pdf'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const idsParam = request.nextUrl.searchParams.get('ids') || ''
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    return new Response('No ids provided', { status: 400 })
  }

  const estimates = await prisma.estimate.findMany({
    where: { id: { in: ids } },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: { estimateNumber: 'asc' },
  })

  if (estimates.length === 0) {
    return new Response('No estimates found', { status: 404 })
  }

  const items: EstimatePdfData[] = estimates.map((estimate) => {
    const clientName = [estimate.client.firstName, estimate.client.lastName]
      .filter(Boolean)
      .join(' ')
    return {
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
  })

  const pdfs = await Promise.all(items.map((item) => generatePdf(item)))

  const zip = new JSZip()
  const usedNames = new Set<string>()
  pdfs.forEach((buf, i) => {
    const num = items[i].type === 'estimate' ? items[i].estimateNumber : ''
    const baseName = `Estimate-${num || 'unknown'}`
    let name = `${baseName}.pdf`
    let dedupe = 1
    while (usedNames.has(name)) {
      name = `${baseName}-${++dedupe}.pdf`
    }
    usedNames.add(name)
    zip.file(name, buf)
  })

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  const uint8 = new Uint8Array(zipBuffer)

  return new Response(uint8, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Estimates_${estimates.length}.zip"`,
      'Content-Length': zipBuffer.length.toString(),
    },
  })
}
