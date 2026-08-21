export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import prisma from '@/lib/prisma'
import { buildFilingExport } from '@/lib/tax/filing'
import { buildLiveSummary, type SlipType } from '@/lib/tax/summary'
import FileFilingClient from './FileFilingClient'

export const metadata: Metadata = { title: 'File Information Return' }

function parseType(raw: string): SlipType | null {
  const t = (raw || '').toUpperCase()
  return t === 'T5' || t === 'T4A' ? (t as SlipType) : null
}

export default async function FileFilingPage({
  params,
}: {
  params: Promise<{ slipType: string; year: string }>
}) {
  const { slipType, year } = await params
  const type = parseType(slipType)
  const taxYear = parseInt(year, 10)
  if (!type || !Number.isInteger(taxYear)) notFound()

  // Run the validation preview (no writes) so the page renders the gate result.
  const built = await buildFilingExport(type, taxYear)
  const summary = await buildLiveSummary(type, taxYear)

  // Has this year already been filed?
  const existingSnapshot = await prisma.taxSlipSummary.findUnique({
    where: { type_taxYear: { type, taxYear } },
    select: { filedAt: true, craSubmissionRef: true, totalRecipients: true },
  })
  const lastExport = await prisma.filingExport.findFirst({
    where: { kind: type === 'T5' ? 't5_return' : 't4a_return', taxYear },
    orderBy: { generatedAt: 'desc' },
    select: { id: true, status: true, generatedAt: true, checksum: true },
  })

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href={`/tax/${type.toLowerCase()}/summary/${taxYear}`} className="text-[#0075DD] hover:underline">
          ← {type} Summary {taxYear}
        </Link>
      </div>

      <FileFilingClient
        type={type}
        taxYear={taxYear}
        report={built.report}
        checksum={built.checksum}
        filer={summary.filer}
        totalRecipients={summary.totalRecipients}
        alreadyFiled={
          existingSnapshot
            ? {
                filedAt: existingSnapshot.filedAt ? existingSnapshot.filedAt.toISOString() : null,
                craSubmissionRef: existingSnapshot.craSubmissionRef,
                totalRecipients: existingSnapshot.totalRecipients,
              }
            : null
        }
        lastExport={
          lastExport
            ? {
                id: lastExport.id,
                status: lastExport.status,
                generatedAt: lastExport.generatedAt.toISOString(),
                checksum: lastExport.checksum,
              }
            : null
        }
      />
    </div>
  )
}
