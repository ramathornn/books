import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildT2Export, filingDatesFor, t2ExportToCsv, t2ExportToText } from '@/lib/tax/t2/export'
import { computeT2Federal } from '@/lib/tax/t2/computeT2Federal'
import { computeAt1 } from '@/lib/tax/t2/computeAt1'
import { getRateTable, engineVersionFor } from '@/lib/tax/t2/rates/index'
import type {
  GifiResult,
  ScheduleEightResult,
  DividendsPaid,
  T2ExportIdentification,
  T2Result,
  ValidationReport,
} from '@/lib/tax/t2/types'

/**
 * GENERIC fixtures only — round figures, never real corporate data. These pin the
 * export contract: the TWO re-key worksheets (federal T2 + Alberta AT1), the
 * filing/balance-due dates off the FYE, the Schedule-1 500/510 carries read back
 * from the merged line map, and the SIN-free checksum.
 */

const RATES = getRateTable(2025, 'AB')
const EV = engineVersionFor(2025)

/** A minimal but complete T2Result for the canonical $300k active persona. */
function makeResult(): T2Result {
  const federal = computeT2Federal(
    {
      taxationYear: 2025,
      taxableIncome: 300000,
      activeBusinessIncome: 300000,
      aggregateInvestmentIncome: 0,
      priorYearAaii: 0,
      taxableCapital: 0,
      portfolioDividendsReceived: 0,
      eligiblePortfolioDividends: 0,
      nonEligiblePortfolioDividends: 0,
      eligibleDividendsPaid: 0,
      nonEligibleDividendsPaid: 100000,
      openingErdtoh: 0,
      openingNerdtoh: 0,
      openingGrip: 0,
      eligibleDividendsReceived: 0,
      isPersonalServicesBusiness: false,
    },
    RATES.federal,
    EV,
  )
  const alberta = computeAt1(
    {
      taxationYear: 2025,
      albertaTaxableIncome: 300000,
      activeBusinessIncome: 300000,
      reducedBusinessLimit: federal.businessLimit,
      allocationFactor: 1.0,
      innovationEmploymentGrant: 0,
      isPersonalServicesBusiness: false,
    },
    RATES.alberta,
    EV,
  )

  const gifi: GifiResult = {
    lines: {},
    netIncome9999: 300000,
    totalAssets2599: 405000,
    totalLiabilities3499: 105000,
    totalEquity3620: 300000,
    retainedEarnings3600: 200000,
    dividendsDeclared3700: 100000,
    roundingPlug: 0,
    closingEntryPosted: false,
    issues: [],
  }
  const scheduleEight: ScheduleEightResult = {
    rows: [
      {
        classNumber: '8',
        description: 'Furniture & equipment',
        openingUcc: 10000,
        additions: 0,
        dispositions: 0,
        acciiAddition: 0,
        halfYearAdjustment: 0,
        ccaBase: 10000,
        ccaRate: 0.2,
        ccaClaimed: 2000,
        closingUcc: 8000,
        method: 'half_year',
        recapture: false,
        terminalLoss: false,
      },
    ],
    totalCcaClaimed: 2000,
    totalRecapture: 0,
    totalTerminalLoss: 0,
    issues: [],
  }
  const dividendsPaid: DividendsPaid = {
    eligible: 0,
    nonEligible: 100000,
    total: 100000,
    dividendsDeclaredAccountId: 'acct-div',
    journalEntryLineIds: ['jel-1'],
  }

  return {
    taxationYear: 2025,
    fiscalYearStart: '2025-01-01',
    fiscalYearEnd: '2025-12-31',
    daysInYear: 365,
    province: 'AB',
    gifi,
    scheduleEight,
    dividendsPaid,
    federal,
    alberta,
    lines: {
      ...federal.lines,
      ...alberta.lines,
      'S1:500': 0,
      'S1:510': 2000,
      'S1:300': 300000,
      'T2:430': 57000,
    },
    engineVersion: EV,
  }
}

const ID: T2ExportIdentification = {
  legalName: 'Test Co Inc.',
  bnRc: '123456789RC0001',
  albertaCan: '0123456789',
  province: 'AB',
  fiscalYearStart: '2025-01-01',
  fiscalYearEnd: '2025-12-31',
  shareholderName: null,
  shareholderSin: null,
}

const OK_REPORT: ValidationReport = {
  ok: true,
  checkedAt: '2026-06-07T00:00:00.000Z',
  taxationYear: 2025,
  province: 'AB',
  issues: [],
}

test('export builds TWO worksheets — federal T2 then Alberta AT1', () => {
  const ex = buildT2Export(makeResult(), ID, OK_REPORT)
  assert.equal(ex.worksheets.length, 2)
  assert.equal(ex.worksheets[0].form, 'T2')
  assert.equal(ex.worksheets[1].form, 'AT1')
  // Each worksheet carries provenance microcopy on every line.
  for (const ws of ex.worksheets) {
    assert.ok(ws.lines.length > 0)
    for (const l of ws.lines) assert.ok(l.provenance.length > 0)
  }
})

test('federal worksheet carries 2599/3499/3620/9999 + S1 500/510/300 from the line map', () => {
  const ex = buildT2Export(makeResult(), ID, OK_REPORT)
  const t2 = ex.worksheets.find((w) => w.form === 'T2')!
  const byLine = new Map(t2.lines.map((l) => [l.line, l.amount]))
  assert.equal(byLine.get('2599'), 405000)
  assert.equal(byLine.get('3499'), 105000)
  assert.equal(byLine.get('3620'), 300000)
  assert.equal(byLine.get('9999'), 300000)
  // Schedule 1 totals are read BACK from the merged line map, not re-derived.
  assert.equal(byLine.get('500'), 0)
  assert.equal(byLine.get('510'), 2000)
  assert.equal(byLine.get('300'), 300000)
  // SBD deduction read from the engine line (no magic 0.19 in the export).
  assert.equal(byLine.get('430'), 57000)
})

test('Alberta worksheet carries 068 / 061 / 070 / 072 + allocation 1.0', () => {
  const ex = buildT2Export(makeResult(), ID, OK_REPORT)
  const at1 = ex.worksheets.find((w) => w.form === 'AT1')!
  const byLine = new Map(at1.lines.map((l) => [l.line, l.amount]))
  assert.equal(byLine.get('068'), 300000)
  assert.equal(byLine.get('allocation'), 1.0)
  // $300k all SBD-rate (within the $500k limit) ⇒ AB tax @ 2% = $6,000.
  assert.equal(byLine.get('072'), 6000)
})

test('filing + balance-due dates are FYE + 6mo / FYE + 3mo', () => {
  const d = filingDatesFor(new Date('2025-12-31T00:00:00.000Z'))
  assert.equal(d.fiscalYearEnd, '2025-12-31')
  assert.equal(d.filingDue, '2026-06-30')
  assert.equal(d.balanceDue, '2026-03-31')
})

test('checksum is stable and excludes the SIN-bearing identity', () => {
  const r = makeResult()
  const a = buildT2Export(r, ID, OK_REPORT)
  // Changing ONLY the shareholder SIN must not change the checksum.
  const b = buildT2Export(r, { ...ID, shareholderSin: '046454286' }, OK_REPORT)
  assert.equal(a.checksum, b.checksum)
  assert.equal(a.checksum.length, 64)
})

test('CSV + text serializers render both forms with line numbers', () => {
  const ex = buildT2Export(makeResult(), ID, OK_REPORT)
  const csv = t2ExportToCsv(ex)
  assert.ok(csv.startsWith('form,line,label,amount,provenance'))
  assert.ok(csv.includes('T2,2599,'))
  assert.ok(csv.includes('AT1,068,'))
  const text = t2ExportToText(ex)
  assert.ok(text.includes('Test Co Inc.'))
  assert.ok(text.includes('Filing due: 2026-06-30'))
  assert.ok(text.includes('Balance due: 2026-03-31'))
})

test('a failed report stamps the text worksheet PROVISIONAL', () => {
  const ex = buildT2Export(makeResult(), ID, { ...OK_REPORT, ok: false })
  const text = t2ExportToText(ex)
  assert.ok(text.includes('PROVISIONAL'))
})
