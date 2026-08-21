import { NextRequest } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  ensureEntityDir,
  ALLOWED_MIME,
  MAX_FILE_SIZE,
  relativeStoragePath,
} from '@/lib/attachments'
import { extractReceipt } from '@/lib/receiptOcr'
import { fileReceiptIntoFolder } from '@/lib/receiptFiling'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const status = sp.get('status') // for_review | reviewed
  const where: Record<string, unknown> = { isArchived: false }
  if (status === 'for_review') where.isReceiptDraft = true
  else if (status === 'reviewed') where.isReceiptDraft = false

  const expenses = await prisma.expense.findMany({
    where,
    include: { vendor: true, category: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const ids = expenses.map((e) => e.id)
  const attachments = await prisma.attachment.findMany({
    where: { entityType: 'expense', entityId: { in: ids }, isArchived: false },
  })
  const attByExpense: Record<string, typeof attachments> = {}
  for (const a of attachments) {
    if (!attByExpense[a.entityId]) attByExpense[a.entityId] = []
    attByExpense[a.entityId].push(a)
  }

  return Response.json({
    data: expenses.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      vendorName: e.vendor?.name || '',
      categoryName: e.category?.name || '',
      amount: Number(e.amount),
      taxAmount: Number(e.taxAmount),
      currency: e.currency,
      description: e.description,
      isReceiptDraft: e.isReceiptDraft,
      createdAt: e.createdAt.toISOString(),
      attachments: (attByExpense[e.id] || []).map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      })),
    })),
  })
}

// POST — upload one or more receipt files; create a draft Expense per file with the attachment linked.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData()
  const files = form.getAll('files').filter((x): x is File => x instanceof File)
  if (files.length === 0) return Response.json({ error: 'No files' }, { status: 400 })

  // Resolve a placeholder category — pick or create "Uncategorized" so the Expense FK is satisfied.
  let placeholder = await prisma.expenseCategory.findFirst({ where: { name: 'Uncategorized' } })
  if (!placeholder) {
    placeholder = await prisma.expenseCategory.create({
      data: { name: 'Uncategorized', groupName: 'Operating Expenses' },
    })
  }

  // Pull active categories once so we can map OCR's suggestedCategory → categoryId
  const categories = await prisma.expenseCategory.findMany({
    where: { isArchived: false },
  })
  function pickCategoryId(suggested: string): string {
    const norm = suggested.trim().toLowerCase()
    if (!norm) return placeholder!.id
    const exact = categories.find((c) => c.name.toLowerCase() === norm)
    if (exact) return exact.id
    const partial = categories.find(
      (c) => c.name.toLowerCase().includes(norm) || norm.includes(c.name.toLowerCase())
    )
    return partial?.id ?? placeholder!.id
  }

  const created: Array<{ id: string; ocrApplied: boolean }> = []
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) continue
    if (!ALLOWED_MIME.has(file.type)) continue

    // Read the buffer once — used both for OCR and disk write
    const buf = Buffer.from(await file.arrayBuffer())

    // Best-effort OCR; falls through to manual review on failure
    const ocr = await extractReceipt({ buffer: buf, mimeType: file.type })

    const expense = await prisma.expense.create({
      data: {
        date: ocr?.date ? new Date(ocr.date) : new Date(),
        amount: ocr ? Math.max(ocr.total - ocr.tax, 0) : 0,
        taxAmount: ocr?.tax ?? 0,
        total: ocr?.total ?? 0,
        currency: ocr?.currency || 'CAD',
        description: ocr?.vendor ? `${ocr.vendor}${ocr.notes ? ` — ${ocr.notes}` : ''}` : file.name,
        notes: ocr ? `OCR confidence: ${ocr.confidence}${ocr.notes ? `\n${ocr.notes}` : ''}` : '',
        status: 'pending',
        isReceiptDraft: true,
        categoryId: ocr ? pickCategoryId(ocr.suggestedCategory) : placeholder!.id,
      },
    })

    const dir = await ensureEntityDir('expense', expense.id)
    const ext = path.extname(file.name).toLowerCase() || '.bin'
    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
    const fullPath = path.join(dir, safeName)
    await fs.writeFile(fullPath, buf)
    const storagePath = relativeStoragePath('expense', expense.id, safeName)

    await prisma.attachment.create({
      data: {
        entityType: 'expense',
        entityId: expense.id,
        fileName: file.name,
        storagePath,
        mimeType: file.type,
        sizeBytes: buf.length,
        uploadedById: (session.user as { id?: string }).id ?? null,
      },
    })

    // Also file a copy into the Files manager under Receipts/YYYY-MM (by receipt
    // date). Best-effort — never blocks the receipt upload if foldering fails.
    await fileReceiptIntoFolder({
      expenseId: expense.id,
      date: expense.date,
      originalName: file.name,
      mimeType: file.type,
      buffer: buf,
    })

    created.push({ id: expense.id, ocrApplied: !!ocr })
  }

  return Response.json({ ok: true, created })
}
