import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()

    // Outstanding invoices (not paid, not draft, not cancelled, not bad debt)
    const outstandingInvoices = await prisma.invoice.findMany({
      where: {
        status: { notIn: ['paid', 'draft', 'cancelled', 'bad_debt'] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        amountDue: true,
        amountPaid: true,
        currency: true,
        dateIssued: true,
        dateDue: true,
        status: true,
        client: {
          select: { firstName: true, lastName: true, organization: true },
        },
      },
    })

    // Calculate outstanding totals by currency
    const outstandingByCurrency: Record<string, number> = {}
    for (const inv of outstandingInvoices) {
      const curr = inv.currency
      outstandingByCurrency[curr] = (outstandingByCurrency[curr] || 0) + Number(inv.amountDue)
    }

    // Overdue invoices
    const overdueInvoices = outstandingInvoices.filter(
      (inv: typeof outstandingInvoices[number]) => new Date(inv.dateDue) < now
    )

    const overdueByCurrency: Record<string, number> = {}
    for (const inv of overdueInvoices) {
      const curr = inv.currency
      overdueByCurrency[curr] = (overdueByCurrency[curr] || 0) + Number(inv.amountDue)
    }

    // Revenue by month (last 12 months) - based on payments
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)

    const payments = await prisma.payment.findMany({
      where: {
        paymentDate: { gte: twelveMonthsAgo },
        status: 'paid',
      },
      select: {
        amount: true,
        currency: true,
        paymentDate: true,
      },
      orderBy: { paymentDate: 'asc' },
    })

    const revenueByMonth: Record<string, Record<string, number>> = {}
    for (const pay of payments) {
      const monthKey = `${pay.paymentDate.getFullYear()}-${String(pay.paymentDate.getMonth() + 1).padStart(2, '0')}`
      if (!revenueByMonth[monthKey]) {
        revenueByMonth[monthKey] = {}
      }
      const curr = pay.currency
      revenueByMonth[monthKey][curr] = (revenueByMonth[monthKey][curr] || 0) + Number(pay.amount)
    }

    // Aging buckets for outstanding invoices
    const agingBuckets: Record<string, { count: number; totalByCurrency: Record<string, number> }> = {
      current: { count: 0, totalByCurrency: {} },
      '1-30': { count: 0, totalByCurrency: {} },
      '31-60': { count: 0, totalByCurrency: {} },
      '61-90': { count: 0, totalByCurrency: {} },
      '90+': { count: 0, totalByCurrency: {} },
    }

    for (const inv of outstandingInvoices) {
      const dueDate = new Date(inv.dateDue)
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      const amountDue = Number(inv.amountDue)
      const curr = inv.currency

      let bucket: string
      if (daysOverdue <= 0) {
        bucket = 'current'
      } else if (daysOverdue <= 30) {
        bucket = '1-30'
      } else if (daysOverdue <= 60) {
        bucket = '31-60'
      } else if (daysOverdue <= 90) {
        bucket = '61-90'
      } else {
        bucket = '90+'
      }

      agingBuckets[bucket].count++
      agingBuckets[bucket].totalByCurrency[curr] =
        (agingBuckets[bucket].totalByCurrency[curr] || 0) + amountDue
    }

    // Summary counts
    const [totalClients, totalInvoices, totalEstimates, totalPayments] = await Promise.all([
      prisma.client.count(),
      prisma.invoice.count(),
      prisma.estimate.count(),
      prisma.payment.count(),
    ])

    // Invoice status breakdown
    const invoicesByStatus = await prisma.invoice.groupBy({
      by: ['status'],
      _count: { id: true },
      _sum: { total: true },
    })

    // Total revenue all time by currency
    const totalRevenue = await prisma.payment.groupBy({
      by: ['currency'],
      where: { status: 'paid' },
      _sum: { amount: true },
    })

    return Response.json({
      summary: {
        totalClients,
        totalInvoices,
        totalEstimates,
        totalPayments,
      },
      outstanding: {
        count: outstandingInvoices.length,
        byCurrency: outstandingByCurrency,
      },
      overdue: {
        count: overdueInvoices.length,
        byCurrency: overdueByCurrency,
      },
      revenueByMonth,
      agingBuckets,
      invoicesByStatus: invoicesByStatus.map((s: typeof invoicesByStatus[number]) => ({
        status: s.status,
        count: s._count.id,
        total: s._sum.total ? Number(s._sum.total) : 0,
      })),
      totalRevenue: totalRevenue.map((r: typeof totalRevenue[number]) => ({
        currency: r.currency,
        total: r._sum.amount ? Number(r._sum.amount) : 0,
      })),
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
