import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { suggestGifiCode, gifiDef, GIFI_REQUIRES_CONFIRM } from '@/lib/tax/t2/gifiCodes'
import type { IncomeNature } from '@/lib/tax/t2/types'

/**
 * GIFI mapping pre-flight (the builder's first step).
 *
 *   GET /api/tax/t2/gifi-map
 *     → every active GL account with its current GIFI code + incomeNature + a
 *       generic keyword-suggested default code (the bulk-mapper surface). Income/
 *       expense accounts that look PASSIVE (Other Income / interest / dividend /
 *       rental / royalty / gain) are flagged `incomeNatureRequired` so the user
 *       must classify them; everything else defaults to 'active'.
 *
 *   PUT /api/tax/t2/gifi-map   { updates: [{ id, gifiCode?, incomeNature? }] }
 *     → bulk-apply GIFI codes + incomeNature classifications. Amortization (8670)
 *       and meals (8523) suggested defaults must be applied explicitly by the
 *       client (they `requiresConfirm`); the server simply persists what is sent.
 */

const PASSIVE_DETAIL = /other income/i
const PASSIVE_NAME = /\b(interest|dividend|rental|royalt|capital gain|realized gain|investment income)\b/i
const KNOWN_NATURE: IncomeNature[] = ['active', 'investment', 'capitalGains']

/** True when an income/expense account looks PASSIVE and must be classified. */
function looksPassive(accountClass: string, detailType: string, accountName: string): boolean {
  if (accountClass !== 'income' && accountClass !== 'expense') return false
  return PASSIVE_DETAIL.test(detailType) || PASSIVE_NAME.test(accountName)
}

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.gLAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      accountNumber: true,
      accountName: true,
      accountClass: true,
      detailType: true,
      gifiCode: true,
      incomeNature: true,
    },
    orderBy: { accountNumber: 'asc' },
  })

  const rows = accounts.map((a) => {
    const suggestion = a.gifiCode ? null : suggestGifiCode({ accountName: a.accountName, detailType: a.detailType })
    const def = a.gifiCode ? gifiDef(a.gifiCode) : null
    const isIncomeExpense = a.accountClass === 'income' || a.accountClass === 'expense'
    return {
      id: a.id,
      accountNumber: a.accountNumber,
      accountName: a.accountName,
      accountClass: a.accountClass,
      detailType: a.detailType,
      gifiCode: a.gifiCode,
      gifiLabel: def?.label ?? null,
      incomeNature: (a.incomeNature as IncomeNature | null) ?? null,
      suggestedCode: suggestion?.code ?? null,
      suggestedLabel: suggestion ? gifiDef(suggestion.code)?.label ?? null : null,
      suggestionRequiresConfirm: suggestion?.requiresConfirm ?? false,
      // income/expense accounts must carry incomeNature before prepare; passive-
      // looking ones force an explicit (non-'active') choice.
      incomeNatureApplicable: isIncomeExpense,
      incomeNatureRequired: looksPassive(a.accountClass, a.detailType, a.accountName),
    }
  })

  const unmapped = rows.filter((r) => !r.gifiCode).length
  const untaggedPassive = rows.filter((r) => r.incomeNatureRequired && !r.incomeNature).length

  return Response.json({ accounts: rows, summary: { total: rows.length, unmapped, untaggedPassive } })
}

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const updates = Array.isArray(body.updates) ? body.updates : []
  if (updates.length === 0) return Response.json({ error: 'No updates provided.' }, { status: 400 })

  let applied = 0
  const requireConfirmHits: string[] = []

  for (const u of updates) {
    const id = String(u?.id ?? '').trim()
    if (!id) continue
    const data: Record<string, unknown> = {}

    if (u.gifiCode !== undefined) {
      const code = u.gifiCode === null || u.gifiCode === '' ? null : String(u.gifiCode).trim()
      if (code !== null && !/^\d{4}$/.test(code)) {
        return Response.json({ error: `GIFI code "${code}" must be 4 digits.` }, { status: 400 })
      }
      if (code && GIFI_REQUIRES_CONFIRM.has(code) && u.confirm !== true) {
        requireConfirmHits.push(code)
        continue
      }
      data.gifiCode = code
    }

    if (u.incomeNature !== undefined) {
      const nature = u.incomeNature === null || u.incomeNature === '' ? null : String(u.incomeNature)
      if (nature !== null && !KNOWN_NATURE.includes(nature as IncomeNature)) {
        return Response.json({ error: `Unknown income nature "${nature}".` }, { status: 400 })
      }
      data.incomeNature = nature
    }

    if (Object.keys(data).length === 0) continue
    await prisma.gLAccount.update({ where: { id }, data })
    applied += 1
  }

  await audit({
    entityType: 'gl_account',
    entityId: 'bulk',
    action: 'update',
    summary: `GIFI mapping updated on ${applied} account(s)`,
    metadata: { applied },
  })

  return Response.json({
    applied,
    requiresConfirm: requireConfirmHits,
    message:
      requireConfirmHits.length > 0
        ? `Applied ${applied}. Codes ${[...new Set(requireConfirmHits)].join(', ')} require explicit confirmation (amortization/meals are load-bearing) — resend with confirm:true.`
        : `Applied ${applied} mapping(s).`,
  })
}
