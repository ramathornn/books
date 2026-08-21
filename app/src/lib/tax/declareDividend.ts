import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { round2 } from '@/lib/tax/round'
import type { DividendKind } from '@/lib/tax/compute/t5'
import { computeGripRoom } from '@/lib/tax/gripRoom'

/**
 * "Declare dividend" flow (design §2/§4, locked user decision T5).
 *
 * Declared dividends are booked to the "3300 Dividends Declared" contra-equity
 * account. The T5 compute (`computeT5`) auto-pulls the actual dividend by summing
 * posted JE DEBITS to that account for the year, so this declaration is the
 * single source of truth feeding the slip.
 *
 * The JE:
 *   DR  3300 Dividends Declared      (reduces equity — declaration)
 *   CR  <credit account>             Dividends Payable (liability) or, if paid
 *                                    immediately, the bank/cash account.
 *
 * The credit account is chosen by the caller. We do NOT invent a Dividends
 * Payable account here; the route resolves it (or accepts an explicit account).
 * `entryDate` defaults to the declaration date; `kind:'dividend'` tags the JE so
 * it is filterable and so the T5 pull can be audited.
 */

export interface DeclareDividendInput {
  /** account being debited — the configured "3300 Dividends Declared". */
  dividendsDeclaredAccountId: string
  /** account being credited — Dividends Payable (liability) or cash/bank. */
  creditAccountId: string
  amount: number
  declaredDate: Date
  /** free-text shareholder/recipient label for the JE description. */
  recipientLabel: string
  /**
   * Dividend eligibility — drives T5 box routing (eligible → 24/25/26,
   * non-eligible → 10/11/12). Persisted on the dividend JE so the T5 GL pull
   * can group declared amounts by eligibility.
   *
   * DEFAULTS to `'nonEligible'` (BLOCKER 3): an owner-managed CCPC paying out of
   * small-business-rate income has $0 GRIP, so non-eligible is the safe default
   * and avoids an excessive eligible designation. Designating ELIGIBLE is gated
   * against live GRIP room (see `declareDividend`). Optional for backward
   * compatibility — omitting it declares a non-eligible dividend.
   */
  eligibility?: DividendKind
  memo?: string
  /** optional client dedupe key — unique on the JE; replays fail with P2002. */
  idempotencyKey?: string | null
}

/** Excessive eligible designation — surfaced distinctly so callers can 422 it. */
export const GRIP_OVER_DESIGNATION_CODE = 'GRIP_OVER_DESIGNATION'

export class GripOverDesignationError extends Error {
  readonly code: string = GRIP_OVER_DESIGNATION_CODE
  readonly roomRemaining: number
  readonly requested: number
  constructor(roomRemaining: number, requested: number) {
    super(
      `Eligible dividend of ${requested.toFixed(2)} exceeds available GRIP room of ` +
        `${roomRemaining.toFixed(2)}. Designating more than the General Rate Income Pool ` +
        `is an excessive eligible dividend designation and triggers the ITA 185.1 Part III.1 ` +
        `penalty tax (20%, or 30% if deemed deliberate). Reduce the amount or declare it ` +
        `non-eligible.`
    )
    this.name = 'GripOverDesignationError'
    this.roomRemaining = roomRemaining
    this.requested = requested
  }
}

export interface DeclareDividendResult {
  journalEntryId: string
  amount: number
}

/**
 * Resolve the configured Dividends Declared account id from CompanySettings.
 * Returns null when not yet wired (run scripts/ensure-tax-accounts.ts).
 */
export async function getDividendsDeclaredAccountId(): Promise<string | null> {
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  return settings?.dividendsDeclaredAccountId ?? null
}

/**
 * Post a dividend-declaration journal entry. Throws if the amount is not
 * positive. Period-lock enforcement is handled inside `createJournalEntry`
 * (`assertNotLocked` on the entryDate), so declaring into a locked period
 * surfaces the standard PERIOD_LOCKED error.
 *
 * Eligibility DEFAULTS to non-eligible (BLOCKER 3). When the caller designates
 * an ELIGIBLE dividend, the amount (plus any eligible dividends already paid this
 * fiscal year) is checked against live GRIP room; an excessive designation
 * throws `GripOverDesignationError` BEFORE any JE is posted (ITA 185.1 guard).
 */
export async function declareDividend(
  input: DeclareDividendInput
): Promise<DeclareDividendResult> {
  const amount = round2(input.amount)
  if (!(amount > 0)) {
    throw new Error('Dividend amount must be a positive number')
  }

  // Default to non-eligible — the safe choice for an SBD-income CCPC ($0 GRIP).
  const eligibility: DividendKind = input.eligibility ?? 'nonEligible'

  // GRIP gate: block designating eligible beyond the General Rate Income Pool.
  // `computeGripRoom` already nets off eligible dividends declared earlier this
  // fiscal year, so the test is THIS new amount against the remaining room.
  if (eligibility === 'eligible') {
    const room = await computeGripRoom({
      declaredDate: input.declaredDate,
      dividendsDeclaredAccountId: input.dividendsDeclaredAccountId,
    })
    if (amount > room.roomRemaining) {
      throw new GripOverDesignationError(room.roomRemaining, amount)
    }
  }

  const je = await createJournalEntry({
    entryDate: input.declaredDate,
    description: `Dividend declared — ${input.recipientLabel}`,
    memo: input.memo ?? '',
    status: 'posted',
    kind: 'dividend',
    dividendEligibility: eligibility,
    idempotencyKey: input.idempotencyKey ?? null,
    lines: [
      {
        glAccountId: input.dividendsDeclaredAccountId,
        description: `Dividend declared — ${input.recipientLabel}`,
        debit: amount,
        credit: 0,
      },
      {
        glAccountId: input.creditAccountId,
        description: `Dividend declared — ${input.recipientLabel}`,
        debit: 0,
        credit: amount,
      },
    ],
  })

  return { journalEntryId: je.id, amount }
}
