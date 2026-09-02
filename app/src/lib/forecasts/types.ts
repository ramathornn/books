// Client-side shape of one forecast scenario. Mirrors the WealthPilot data
// model (rows keyed by name, one value per month) so the formula engine and
// computed layer port unchanged. The server assembles it from the relational
// Forecast* tables (see serialize.ts) and the client keeps it in sync via
// granular API calls.

/** A cell is a literal number or a formula string starting with "=". */
export type CellValue = number | string

export type Section = 'income' | 'expenses' | 'receivables'

export type DebtType = 'loan' | 'simple'

export interface DebtSettings {
  type: DebtType
  interestRate: number
  amortizationMonths: number | null
  remainingMonths: number | null
  linkedExpense: string | null
  linkedAsset: string | null
}

export type AssetType = 'property' | 'vehicle' | 'investment' | 'cash' | 'other'

export interface Asset {
  value: number
  type: AssetType
  linkedDebt: string | null
}

export interface BankSnapshot {
  amount: number
  day: number
}

/** 'last' = last day of the month. */
export type FlowDayValue = number | 'last'

export interface FlowDayRecord {
  schedule: { from: number; day: FlowDayValue }[]
  overrides: Record<string, FlowDayValue>
}

export type FlowDays = Partial<Record<Section, Record<string, FlowDayRecord>>>

export interface ScenarioSummary {
  id: string
  name: string
  kind: 'personal' | 'business'
}

export interface ForecastIds {
  rows: Record<Section, Record<string, string>>
  /** category name -> id (expenses headers) */
  categories: Record<string, string>
  assets: Record<string, string>
}

/** Provenance of a row derived from Books (never stored; rebuilt on every load). */
export interface LinkedInfo {
  source: 'client' | 'bill' | 'recurring' | 'spend' | 'owner-pay'
  refId?: string
  note?: string
}

export type BookEventKind = 'collected' | 'expected' | 'draft' | 'recurring' | 'bill' | 'spend' | 'owner-pay' | 'runrate'

/** A dated cash event derived from Books, in CAD. `row` matches a linked row name. */
export interface BookEvent {
  date: string // YYYY-MM-DD (local calendar date)
  monthIndex: number
  section: 'income' | 'expenses'
  row: string
  amount: number
  kind: BookEventKind
  label: string
  refId?: string
}

export interface ForecastData extends ScenarioSummary {
  booksLinked: boolean
  ownerPayGlAccountIds: string[]
  /** Rows whose values come from Books; keyed by section then row name. */
  linked: Partial<Record<Section, Record<string, LinkedInfo>>>
  /** Day-level Books events backing the linked rows (drives the timeline). */
  bookEvents: BookEvent[]
  /** For each linked row, which month indexes are locked to Books (past/current months, or future months with real Books activity). Other months hold the user's manual forecast. */
  linkedOverride: Partial<Record<Section, Record<string, boolean[]>>>
  /** Cash-on-hand anchor taken from Books banking (only when booksLinked and no manual snapshot that month). */
  linkedBank: { monthIndex: number; day: number; amount: number; asOf: string } | null
  months: string[]
  viewFrom: number
  viewTo: number
  income: Record<string, CellValue[]>
  /** Keys starting with "_" are category headers with a null value. Object order = display order. */
  expenses: Record<string, CellValue[] | null>
  receivables: Record<string, CellValue[]>
  debtSettings: Record<string, DebtSettings>
  assets: Record<string, Asset>
  bankBalances: Record<string, BankSnapshot>
  flowDays: FlowDays
  incomeCurrencies: Record<string, string>
  _hidden: Partial<Record<Section, Record<string, boolean>>>
  rateOverrides: Record<string, number>
  ids: ForecastIds
}

/** CAD per 1 unit of each currency. */
export type Rates = Record<string, number> & { USD: number; EUR: number }

/** Cookie that remembers the selected scenario. Lives here (not in a 'use client' module) so server code gets the real string. */
export const SCENARIO_COOKIE = 'forecast_scenario'
