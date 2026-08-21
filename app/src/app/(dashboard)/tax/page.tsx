export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'

import prisma from '@/lib/prisma'

export const metadata: Metadata = { title: 'Tax' }

/**
 * Tax landing — entry point to the information-return modules (T5, T4A), the
 * recipient directory, and the T5 "declare dividend" flow. Each slip card links
 * into the descriptor-driven `/tax/[slipType]` list for the most recent filing
 * year (last calendar year by default).
 */
export default async function TaxHomePage() {
  const filingYear = new Date().getFullYear() - 1

  const [t5Count, t4aCount, recipientCount] = await Promise.all([
    prisma.taxSlip.count({ where: { type: 'T5', taxYear: filingYear } }),
    prisma.taxSlip.count({ where: { type: 'T4A', taxYear: filingYear } }),
    prisma.taxParty.count({ where: { isArchived: false } }),
  ])

  const cards = [
    {
      href: `/tax/t5?year=${filingYear}`,
      title: 'T5 — Investment Income',
      desc: 'Statement of Investment Income (dividends). Auto-pulls from Dividends Declared.',
      meta: `${t5Count} slip${t5Count === 1 ? '' : 's'} for ${filingYear}`,
    },
    {
      href: `/tax/t4a?year=${filingYear}`,
      title: 'T4A — Other Income',
      desc: 'Pension, annuity & other income — incl. Box 048 fees for services (subcontractors).',
      meta: `${t4aCount} slip${t4aCount === 1 ? '' : 's'} for ${filingYear}`,
    },
    {
      href: '/tax/t1',
      title: 'Personal Tax (T1)',
      desc: 'Prepare & verify a personal income-tax return — auto-pulls your dividend slips. Re-key into certified software.',
      meta: 'Prepare & verify',
    },
    {
      href: '/tax/t2',
      title: 'Corporate Tax (T2)',
      desc: 'Prepare & verify the federal T2 + Alberta AT1 from your books — GIFI roll-up, CCA, the SBD, RDTOH/GRIP. Re-key into certified software.',
      meta: 'Prepare & verify',
    },
    {
      href: '/tax/recipients',
      title: 'Recipients',
      desc: 'Manage slip recipients (individuals & businesses). SINs stored encrypted.',
      meta: `${recipientCount} recipient${recipientCount === 1 ? '' : 's'}`,
    },
    {
      href: '/tax/declare-dividend',
      title: 'Declare a dividend',
      desc: 'Post a dividend declaration to Dividends Declared — the source for the T5 auto-pull.',
      meta: 'T5 source',
    },
  ]

  return (
    <div>
      <h1
        className="text-[28px] sm:text-[40px] font-medium text-[#001B40] mb-1"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        Tax
      </h1>
      <p className="text-sm text-[#576981] mb-6">
        CRA information returns and supporting flows. Filing year defaults to {filingYear}.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block rounded-lg border border-[#E5EAF1] bg-white p-5 hover:border-[#0075DD] hover:shadow-sm transition"
          >
            <div className="text-[#001B40] font-medium">{c.title}</div>
            <div className="text-sm text-[#576981] mt-1">{c.desc}</div>
            <div className="text-xs text-[#8595A8] mt-3">{c.meta}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
