import { PrismaClient } from '../src/generated/prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

// Try multiple data directory locations
const possibleDataDirs = [
  path.resolve(__dirname, '../data'),      // ../data from scripts/ (server layout)
  path.resolve(__dirname, '../../data'),   // ../../data from scripts/ (monorepo layout)
]
const DATA_DIR = possibleDataDirs.find(d => fs.existsSync(d)) || possibleDataDirs[0]

interface RawEstimate {
  fb_id: string
  estimate_number: string
  status: string
  currency: string
  date_issued: string
  billed_to: string
  subtotal: string
  tax_totals: { name: string; amount: string }[]
  total: string
  line_items: {
    description: string
    rate: string
    qty: string
    line_total: string
    tax_codes: string[]
  }[]
}

function parseDateString(dateStr: string): Date {
  if (!dateStr || dateStr.trim() === '') return new Date()
  const parts = dateStr.trim().split('/')
  if (parts.length !== 3) return new Date(dateStr)
  const month = parseInt(parts[0], 10)
  const day = parseInt(parts[1], 10)
  const year = parseInt(parts[2], 10)
  return new Date(Date.UTC(year, month - 1, day))
}

async function main() {
  console.log('=== Fix Estimate Dates ===')

  const rawEstimates: RawEstimate[] = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'estimates.json'), 'utf-8')
  )

  console.log(`Estimates in JSON: ${rawEstimates.length}`)

  // Get all estimates from DB
  const dbEstimates = await prisma.estimate.findMany()
  console.log(`Estimates in DB: ${dbEstimates.length}`)

  let fixed = 0
  let alreadyCorrect = 0
  let notFound = 0

  for (const raw of rawEstimates) {
    const correctDate = parseDateString(raw.date_issued)

    // Find by fbId
    const dbEstimate = dbEstimates.find(e => e.fbId === raw.fb_id)

    if (!dbEstimate) {
      // Try by estimate number
      const byNumber = dbEstimates.find(e => e.estimateNumber === raw.estimate_number)
      if (!byNumber) {
        console.log(`  NOT FOUND: estimate ${raw.estimate_number} (fb_id: ${raw.fb_id})`)
        notFound++
        continue
      }

      const currentDate = byNumber.dateIssued
      if (currentDate.getTime() === correctDate.getTime()) {
        alreadyCorrect++
        continue
      }

      console.log(`  Fixing ${raw.estimate_number}: ${currentDate.toISOString()} => ${correctDate.toISOString()} (source: ${raw.date_issued})`)

      await prisma.estimate.update({
        where: { id: byNumber.id },
        data: { dateIssued: correctDate },
      })
      fixed++
      continue
    }

    const currentDate = dbEstimate.dateIssued
    if (currentDate.getTime() === correctDate.getTime()) {
      alreadyCorrect++
      continue
    }

    console.log(`  Fixing ${raw.estimate_number}: ${currentDate.toISOString()} => ${correctDate.toISOString()} (source: ${raw.date_issued})`)

    await prisma.estimate.update({
      where: { id: dbEstimate.id },
      data: { dateIssued: correctDate },
    })
    fixed++
  }

  console.log(`\n=== Results ===`)
  console.log(`Estimates fixed: ${fixed}`)
  console.log(`Already correct: ${alreadyCorrect}`)
  console.log(`Not found in DB: ${notFound}`)

  // Show the date range of estimates now
  const updatedEstimates = await prisma.estimate.findMany({
    orderBy: { dateIssued: 'asc' },
    select: { estimateNumber: true, dateIssued: true },
  })
  console.log(`\nDate range after fix:`)
  if (updatedEstimates.length > 0) {
    console.log(`  Earliest: ${updatedEstimates[0].estimateNumber} - ${updatedEstimates[0].dateIssued.toISOString()}`)
    console.log(`  Latest: ${updatedEstimates[updatedEstimates.length - 1].estimateNumber} - ${updatedEstimates[updatedEstimates.length - 1].dateIssued.toISOString()}`)
  }
}

main()
  .catch((e) => {
    console.error('Fix-estimate-dates failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
