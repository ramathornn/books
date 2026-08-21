import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import { computeGst34, type Gst34Lines } from '@/lib/tax/compute/gst34'
import { renderGst34Worksheet } from '@/lib/tax/pdf/Gst34Worksheet'

/**
 * Render the GST34 printable worksheet PDF.
 *
 * Two modes:
 *  - ?returnId=<id>   → render the FROZEN gst34Detail snapshot of a filed return.
 *  - ?start=&end=     → render a live (draft) worksheet computed on the fly.
 *
 * There is no transmit file — this worksheet plus the on-screen NETFILE entry
 * helper are the only GST34 outputs.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const sp = request.nextUrl.searchParams
  const company = await getCompanySettings()
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })

  const bnRt = [settings?.businessNumber?.trim()].filter(Boolean).join(' ').trim() || '—'
  const filer = {
    legalName: company.legalName || company.name || '',
    bnRt: bnRt === '—' ? 'BN —' : `BN ${bnRt}`,
    address: company.addressSingleLine || '',
  }

  let lines: Gst34Lines
  let periodStart: string
  let periodEnd: string
  let filingFrequency = settings?.gstFilingFrequency || 'quarterly'
  let isDraft = true

  const returnId = sp.get('returnId')
  if (returnId) {
    const tr = await prisma.taxReturn.findUnique({ where: { id: returnId } })
    if (!tr) return new Response('Return not found', { status: 404 })
    periodStart = tr.periodStart.toISOString().slice(0, 10)
    periodEnd = tr.periodEnd.toISOString().slice(0, 10)
    filingFrequency = tr.filingFrequency || filingFrequency
    isDraft = tr.status !== 'filed' && tr.status !== 'paid'
    const detail = tr.gst34Detail as { lines?: Gst34Lines } | null
    if (detail?.lines) {
      lines = detail.lines
    } else {
      // Legacy filed return without a frozen snapshot — reconstruct from columns.
      const collected = Number(tr.collectedAmount)
      const paid = Number(tr.paidAmount)
      lines = {
        line101: 0,
        line103: collected,
        line104: 0,
        line105: collected,
        line106: paid,
        line107: 0,
        line108: paid,
        line109: Number(tr.netAmount),
      }
    }
  } else {
    const startStr = sp.get('start')
    const endStr = sp.get('end')
    if (!startStr || !endStr) return new Response('start and end (or returnId) required', { status: 400 })
    const start = new Date(startStr)
    const end = new Date(endStr)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return new Response('Invalid dates', { status: 400 })
    }
    const excludeIds: string[] = []
    if (settings?.realizedFxAccountId) excludeIds.push(settings.realizedFxAccountId)
    const interestAccounts = await prisma.gLAccount.findMany({
      where: { accountClass: 'income', accountName: { contains: 'interest', mode: 'insensitive' } },
      select: { id: true },
    })
    for (const a of interestAccounts) if (!excludeIds.includes(a.id)) excludeIds.push(a.id)
    const result = await computeGst34({
      start,
      end,
      gstPayableAccountId: settings?.defaultGstPayableAccountId ?? null,
      excludeIncomeAccountIds: excludeIds,
    })
    lines = result.lines
    periodStart = result.sourceRef.periodStart
    periodEnd = result.sourceRef.periodEnd
  }

  const buffer = await renderGst34Worksheet({
    filer,
    periodStart,
    periodEnd,
    filingFrequency,
    lines: lines as unknown as Record<string, number>,
    isDraft,
  })
  const uint8 = new Uint8Array(buffer)

  return new Response(uint8, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="GST34_Worksheet_${periodStart}_${periodEnd}.pdf"`,
      'Content-Length': String(buffer.length),
    },
  })
}
