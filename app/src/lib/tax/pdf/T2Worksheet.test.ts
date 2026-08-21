import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderT2Worksheet, scheduleEightCcaRows } from '@/lib/tax/pdf/T2Worksheet'
import { buildT2Export } from '@/lib/tax/t2/export'
import { computeT2Federal } from '@/lib/tax/t2/computeT2Federal'
import { computeAt1 } from '@/lib/tax/t2/computeAt1'
import { getRateTable, engineVersionFor } from '@/lib/tax/t2/rates/index'
import type { T2ExportIdentification, T2Result, ValidationReport } from '@/lib/tax/t2/types'

const R = getRateTable(2025, 'AB')
const EV = engineVersionFor(2025)

function result(): T2Result {
  const fed = computeT2Federal(
    { taxationYear: 2025, taxableIncome: 300000, activeBusinessIncome: 300000, aggregateInvestmentIncome: 0, priorYearAaii: 0, taxableCapital: 0, portfolioDividendsReceived: 0, eligiblePortfolioDividends: 0, nonEligiblePortfolioDividends: 0, eligibleDividendsPaid: 0, nonEligibleDividendsPaid: 0, openingErdtoh: 0, openingNerdtoh: 0, openingGrip: 0, eligibleDividendsReceived: 0, isPersonalServicesBusiness: false },
    R.federal, EV,
  )
  const ab = computeAt1(
    { taxationYear: 2025, albertaTaxableIncome: 300000, activeBusinessIncome: 300000, reducedBusinessLimit: fed.businessLimit, allocationFactor: 1, innovationEmploymentGrant: 0, isPersonalServicesBusiness: false },
    R.alberta, EV,
  )
  return {
    taxationYear: 2025, fiscalYearStart: '2025-01-01', fiscalYearEnd: '2025-12-31', daysInYear: 365, province: 'AB',
    gifi: { lines: {}, netIncome9999: 300000, totalAssets2599: 405000, totalLiabilities3499: 105000, totalEquity3620: 300000, retainedEarnings3600: 200000, dividendsDeclared3700: 0, roundingPlug: 0, closingEntryPosted: false, issues: [] },
    scheduleEight: { rows: [{ classNumber: '8', description: 'Equipment', openingUcc: 10000, additions: 0, dispositions: 0, acciiAddition: 0, halfYearAdjustment: 0, ccaBase: 10000, ccaRate: 0.2, ccaClaimed: 2000, closingUcc: 8000, method: 'half_year', recapture: false, terminalLoss: false }], totalCcaClaimed: 2000, totalRecapture: 0, totalTerminalLoss: 0, issues: [] },
    dividendsPaid: { eligible: 0, nonEligible: 0, total: 0, dividendsDeclaredAccountId: null, journalEntryLineIds: [] },
    federal: fed, alberta: ab,
    lines: { ...fed.lines, ...ab.lines, 'S1:500': 0, 'S1:510': 2000, 'S1:300': 300000, 'T2:430': 57000 },
    engineVersion: EV,
  }
}

const ID: T2ExportIdentification = { legalName: 'Test Co Inc.', bnRc: '123456789RC0001', albertaCan: '0123456789', province: 'AB', fiscalYearStart: '2025-01-01', fiscalYearEnd: '2025-12-31', shareholderName: null, shareholderSin: null }
const REPORT: ValidationReport = { ok: true, checkedAt: 'x', taxationYear: 2025, province: 'AB', issues: [] }

test('renderT2Worksheet produces a valid PDF buffer (both forms)', async () => {
  const ex = buildT2Export(result(), ID, REPORT)
  const buf = await renderT2Worksheet(ex)
  assert.ok(buf.length > 1000)
  assert.equal(buf.slice(0, 5).toString(), '%PDF-')
})

test('scheduleEightCcaRows projects S8 rows into the CcaSchedule PDF shape', () => {
  const rows = scheduleEightCcaRows(result().scheduleEight.rows)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].classNumber, '8')
  assert.equal(rows[0].ccaClaimed, 2000)
  assert.equal(rows[0].terminalLossPossible, false)
})
