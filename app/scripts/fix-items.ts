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

interface RawItem {
  name: string
  description: string
  taxes: string
  rate: string
}

function parseAmount(str: string): number {
  if (!str || str.trim() === '') return 0
  const cleaned = str.trim()
  const isNegative = cleaned.startsWith('-') || cleaned.startsWith('\u2212') ||
    cleaned.includes('-\u20AC') || cleaned.includes('-$') || cleaned.includes('-\u00A3')
  const numStr = cleaned
    .replace(/[\u2212\-]/g, '')
    .replace(/[$\u20AC\u00A3\u00A5]/g, '')
    .replace(/,/g, '')
    .replace(/\s*(CAD|USD|EUR|GBP)\s*/gi, '')
    .trim()
  const num = parseFloat(numStr)
  if (isNaN(num)) return 0
  return isNegative ? -num : num
}

async function main() {
  console.log('=== Fix Items Seed ===')

  const rawItems: RawItem[] = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'items.json'), 'utf-8')
  )

  console.log(`Raw items in JSON: ${rawItems.length}`)

  // Deduplicate by name (case-sensitive, first occurrence wins)
  const seenNames = new Set<string>()
  const uniqueItems: RawItem[] = []
  for (const item of rawItems) {
    if (!seenNames.has(item.name)) {
      seenNames.add(item.name)
      uniqueItems.push(item)
    }
  }

  console.log(`Unique items after dedup: ${uniqueItems.length}`)

  // Delete all existing items first for clean slate
  const deleteResult = await prisma.item.deleteMany({})
  console.log(`Deleted ${deleteResult.count} existing items`)

  let created = 0
  let failed = 0

  for (const item of uniqueItems) {
    try {
      const rate = parseAmount(item.rate)
      console.log(`  Parsing rate "${item.rate}" => ${rate}`)

      await prisma.item.create({
        data: {
          name: item.name,
          description: item.description || '',
          rate,
          taxes: item.taxes || '',
          category: 'service',
        },
      })
      created++
    } catch (err) {
      console.error(`  FAILED to create item "${item.name}":`, err)
      failed++
    }
  }

  // Verify
  const totalItems = await prisma.item.count()

  console.log(`\n=== Results ===`)
  console.log(`Items created: ${created}`)
  console.log(`Items failed: ${failed}`)
  console.log(`Total items in DB: ${totalItems}`)
}

main()
  .catch((e) => {
    console.error('Fix-items failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
