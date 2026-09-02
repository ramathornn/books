import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, isUniqueViolation } from '@/lib/forecasts/api'
import { forecastRowPatchSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string; rowId: string }> }

// Rename / retag / hide a row, or change a debt's balance mechanics.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id, rowId } = await params
  const row = await prisma.forecastRow.findFirst({ where: { id: rowId, scenarioId: id }, select: { id: true, section: true } })
  if (!row) return notFound('Row')
  const parsed = await parseBody(request, forecastRowPatchSchema)
  if ('error' in parsed) return parsed.error
  const d = parsed.data

  // Links must stay inside the same scenario and point at the right section.
  if (d.linkedExpenseId) {
    const exp = await prisma.forecastRow.findFirst({ where: { id: d.linkedExpenseId, scenarioId: id, section: 'expense' }, select: { id: true } })
    if (!exp) return notFound('Linked expense')
  }
  if (d.linkedAssetId) {
    const asset = await prisma.forecastAsset.findFirst({ where: { id: d.linkedAssetId, scenarioId: id }, select: { id: true } })
    if (!asset) return notFound('Linked asset')
  }
  if (d.categoryId) {
    const cat = await prisma.forecastCategory.findFirst({ where: { id: d.categoryId, scenarioId: id }, select: { id: true } })
    if (!cat) return notFound('Category')
  }
  try {
    const updated = await prisma.forecastRow.update({
      where: { id: rowId },
      data: {
        name: d.name,
        currency: row.section === 'income' ? d.currency : undefined,
        hidden: d.hidden,
        categoryId: row.section === 'expense' ? d.categoryId : undefined,
        debtType: d.debtType,
        interestRate: d.interestRate,
        amortizationMonths: d.amortizationMonths,
        remainingMonths: d.remainingMonths,
        linkedExpenseId: d.linkedExpenseId,
        linkedAssetId: d.linkedAssetId,
      },
      select: { id: true, name: true, currency: true, hidden: true, categoryId: true },
    })
    return Response.json(updated)
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: 'A row with that name already exists in this section' }, { status: 409 })
    throw e
  }
}

// Delete a row and its cells. Links from other rows/assets are nulled by the schema.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id, rowId } = await params
  const row = await prisma.forecastRow.findFirst({ where: { id: rowId, scenarioId: id }, select: { id: true } })
  if (!row) return notFound('Row')
  await prisma.forecastRow.delete({ where: { id: rowId } })
  return Response.json({ ok: true })
}
