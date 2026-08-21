import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

type SortBy = 'name' | 'contact' | 'outstanding' | 'draft'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const PER_PAGE_RAW = Number(sp.get('perPage')) || 50
  const PER_PAGE = [25, 50, 100].includes(PER_PAGE_RAW) ? PER_PAGE_RAW : 50
  const search = sp.get('search') || undefined
  const sortByRaw = sp.get('sortBy') || 'outstanding'
  const sortBy: SortBy =
    sortByRaw === 'contact' || sortByRaw === 'name' || sortByRaw === 'draft' || sortByRaw === 'outstanding'
      ? (sortByRaw as SortBy)
      : 'outstanding'
  const defaultDir: 'asc' | 'desc' =
    sortBy === 'outstanding' || sortBy === 'draft' ? 'desc' : 'asc'
  const sortDir =
    sp.get('sort') === 'desc' ? 'desc' : sp.get('sort') === 'asc' ? 'asc' : defaultDir

  const company = sp.get('company') || undefined
  const contact = sp.get('contact') || undefined
  const advEmail = sp.get('email') || undefined
  const keyword = sp.get('keyword') || undefined

  const ANDs: Record<string, unknown>[] = []
  if (search) {
    ANDs.push({
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { organization: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    })
  }
  if (company)
    ANDs.push({ organization: { contains: company, mode: 'insensitive' } })
  if (contact) {
    ANDs.push({
      OR: [
        { firstName: { contains: contact, mode: 'insensitive' } },
        { lastName: { contains: contact, mode: 'insensitive' } },
      ],
    })
  }
  if (advEmail)
    ANDs.push({ email: { contains: advEmail, mode: 'insensitive' } })
  if (keyword) {
    ANDs.push({
      OR: [
        { internalNote: { contains: keyword, mode: 'insensitive' } },
        { organization: { contains: keyword, mode: 'insensitive' } },
        { firstName: { contains: keyword, mode: 'insensitive' } },
        { lastName: { contains: keyword, mode: 'insensitive' } },
      ],
    })
  }
  const where = ANDs.length > 0 ? { AND: ANDs } : {}

  const totalCount = await prisma.client.count({ where })

  const all = await prisma.client.findMany({
    where,
    include: {
      invoices: {
        where: { status: { not: 'paid' } },
        select: { amountDue: true, total: true, currency: true, status: true },
      },
    },
  })

  type ClientWithSums = (typeof all)[number] & {
    totalOutstanding: number
    totalDraft: number
    outstandingByCurrency: Record<string, number>
    draftByCurrency: Record<string, number>
  }

  const enriched: ClientWithSums[] = all.map((c) => {
    const outstandingByCurrency: Record<string, number> = {}
    const draftByCurrency: Record<string, number> = {}
    let totalOutstanding = 0
    let totalDraft = 0
    for (const inv of c.invoices) {
      if (inv.status === 'draft') {
        const amt = Number(inv.total)
        draftByCurrency[inv.currency] = (draftByCurrency[inv.currency] || 0) + amt
        totalDraft += amt
      } else {
        const amt = Number(inv.amountDue)
        outstandingByCurrency[inv.currency] =
          (outstandingByCurrency[inv.currency] || 0) + amt
        totalOutstanding += amt
      }
    }
    return {
      ...c,
      totalOutstanding,
      totalDraft,
      outstandingByCurrency,
      draftByCurrency,
    }
  })

  const sortKeyName = (c: {
    organization: string
    lastName: string
    firstName: string
  }) =>
    (c.organization?.trim() ||
      `${c.lastName} ${c.firstName}`.trim() ||
      c.firstName ||
      '')
      .toLowerCase()

  const sortKeyContact = (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim().toLowerCase()

  enriched.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'outstanding') {
      if (a.totalOutstanding !== b.totalOutstanding) {
        return (a.totalOutstanding - b.totalOutstanding) * dir
      }
      // Tiebreak: draft desc
      if (a.totalDraft !== b.totalDraft) return b.totalDraft - a.totalDraft
      return sortKeyName(a).localeCompare(sortKeyName(b))
    }
    if (sortBy === 'draft') {
      if (a.totalDraft !== b.totalDraft) {
        return (a.totalDraft - b.totalDraft) * dir
      }
      if (a.totalOutstanding !== b.totalOutstanding)
        return b.totalOutstanding - a.totalOutstanding
      return sortKeyName(a).localeCompare(sortKeyName(b))
    }
    const ka = sortBy === 'contact' ? sortKeyContact(a) : sortKeyName(a)
    const kb = sortBy === 'contact' ? sortKeyContact(b) : sortKeyName(b)
    return ka.localeCompare(kb) * dir
  })

  const slice = enriched.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const rows = slice.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    organization: c.organization,
    internalNote: c.internalNote,
    currency: c.currency,
    outstandingByCurrency: c.outstandingByCurrency,
    draftByCurrency: c.draftByCurrency,
  }))

  const totals: Record<string, number> = {}
  for (const r of rows) {
    if (!(r.currency in totals)) totals[r.currency] = 0
    for (const [c, amt] of Object.entries(r.outstandingByCurrency)) {
      totals[c] = (totals[c] || 0) + amt
    }
  }

  return Response.json({
    rows,
    totalCount,
    totalPages: Math.ceil(totalCount / PER_PAGE),
    perPage: PER_PAGE,
    page,
    sortBy,
    sortDir,
    totals: Object.entries(totals).sort((a, b) => b[1] - a[1]),
  })
}
