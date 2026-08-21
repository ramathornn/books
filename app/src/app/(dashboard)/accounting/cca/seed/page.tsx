export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import CcaSeedClient from './CcaSeedClient'

export const metadata: Metadata = { title: 'CCA — Seed opening UCC' }

export default async function CcaSeedPage() {
  const classes = await prisma.ccaClass.findMany({
    where: { isArchived: false },
    orderBy: { classNumber: 'asc' },
    select: { id: true, classNumber: true, description: true, rate: true },
  })

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting/cca" className="text-[#0075DD] hover:underline">← Capital Cost Allowance</Link>
      </div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Seed opening UCC
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Enter each class&apos;s undepreciated capital cost brought forward from your prior Schedule 8
          (or accountant) for a starting tax year. This creates the first schedule year; from there the
          grid rolls each closing UCC forward into the next open year. Seeding does not post to the GL.
        </p>
      </div>

      <CcaSeedClient
        classes={classes.map((c) => ({
          id: c.id,
          classNumber: c.classNumber,
          description: c.description,
          rate: Number(c.rate),
        }))}
      />
    </div>
  )
}
