import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

const DATA_PATHS = [
  path.resolve(__dirname, '..', 'data'),
  path.resolve(__dirname, '..', '..', 'data'),
]

function findDataFile(name: string): string {
  for (const dir of DATA_PATHS) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  throw new Error(`Could not find ${name}`)
}

interface RuleCondition {
  field: string
  op: string // contains | equals
  value: string
}

interface ImportedRule {
  priority: number
  name: string
  appliedTo: string // e.g. "1130 Business Chequing (0001)" or "Multiple"
  conditions: RuleCondition[]
  conditionLogic: string
  actions: {
    category?: string // e.g. "6270 Vehicle - Gas & Oil"
    payee?: string
    memo?: string
    memoAppend?: string
    globalTax?: string // GST | Out of Scope | Zero-Rated | etc.
  }
  autoAdd: boolean
  status: string
}

// Map the exported rule's tax label -> our TaxCode.code
function mapTaxCode(label: string | undefined): string | null {
  if (!label) return null
  const t = label.trim().toLowerCase()
  if (t === 'gst') return 'GST_EXPENSE'
  if (t === 'out of scope') return 'OUT_OF_SCOPE'
  if (t === 'zero-rated' || t === 'zero rated') return 'ZERO_RATED'
  if (t === 'meals') return 'MEALS_50'
  if (t === 'exempt') return 'EXEMPT'
  return null
}

// Normalize "1130 Business Chequing (0001)" -> account number "1130"
function appliedToAccountNumber(label: string): string | null {
  const m = label.match(/^([\w-]+)\s/)
  return m ? m[1] : null
}

// Normalize "6270 Vehicle - Gas & Oil" -> account number "6270"
function categoryAccountNumber(label: string): string | null {
  const m = label.match(/^([\w-]+)\s/)
  return m ? m[1] : null
}

async function main() {
  console.log('Seeding bank rules')
  console.log('  DB:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'))

  const raw = JSON.parse(fs.readFileSync(findDataFile('bank_rules.json'), 'utf8')) as ImportedRule[]
  console.log(`  Read ${raw.length} rules from bank_rules.json`)

  let inserted = 0
  let updated = 0
  for (const r of raw) {
    // Resolve scope
    const acctNum = appliedToAccountNumber(r.appliedTo)
    let accountIds: string[] = []
    let accountScope: 'all' | 'specific' = 'all'
    if (acctNum) {
      const gl = await prisma.gLAccount.findUnique({ where: { accountNumber: acctNum } })
      if (gl) {
        const ba = await prisma.bankAccount.findUnique({ where: { glAccountId: gl.id } })
        if (ba) {
          accountIds = [ba.id]
          accountScope = 'specific'
        }
      }
    }

    // Resolve category GL account
    const catNum = r.actions.category ? categoryAccountNumber(r.actions.category) : null
    const catGl = catNum
      ? await prisma.gLAccount.findUnique({ where: { accountNumber: catNum } })
      : null

    // Resolve tax code
    const taxCodeCode = mapTaxCode(r.actions.globalTax)
    const taxCode = taxCodeCode
      ? await prisma.taxCode.findUnique({ where: { code: taxCodeCode } })
      : null

    // Determine money direction from rule name & content
    let moneyDirection: 'in' | 'out' | 'both' = 'both'
    const lc = (r.name + ' ' + (r.actions.category || '')).toLowerCase()
    if (lc.includes('fuel') || lc.includes('charges') || lc.includes('fee') || lc.includes('e-transfer sent') || lc.includes('shareholder')) {
      moneyDirection = 'out'
    }

    // Conditions: normalize to our schema (strings: bankText)
    const conditions = r.conditions.map((c) => ({
      field: 'bankText' as const,
      op: c.op === 'equals' ? ('equals' as const) : ('contains' as const),
      value: c.value,
    }))

    // Determine type
    const isShareholder = (r.actions.category || '').toLowerCase().includes('shareholder')
    const thenType = isShareholder ? 'transfer' : 'expense'

    const data = {
      name: r.name,
      priority: r.priority,
      moneyDirection,
      accountScope,
      accountIds,
      conditionLogic: 'any',
      conditions,
      thenTransactionType: thenType,
      categoryGlAccountId: catGl?.id || null,
      categoryId: null,
      vendorId: null,
      payee: r.actions.payee || '',
      taxCodeId: taxCode?.id || null,
      memo: r.actions.memo || '',
      memoAppend: r.actions.memoAppend || '',
      splits: [],
      autoAdd: !!r.autoAdd,
      isActive: r.status === 'Active',
    }

    // Upsert by (name, priority) — there's no unique constraint, so look up first
    const existing = await prisma.bankRule.findFirst({
      where: { name: r.name, priority: r.priority },
    })
    if (existing) {
      await prisma.bankRule.update({ where: { id: existing.id }, data })
      updated += 1
    } else {
      await prisma.bankRule.create({ data })
      inserted += 1
    }
  }

  console.log(`  ✓ ${inserted} inserted, ${updated} updated`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
