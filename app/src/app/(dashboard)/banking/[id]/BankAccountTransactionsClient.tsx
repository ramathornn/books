'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import CategorizeDrawer, { type DrawerData } from './CategorizeDrawer'
import CsvImportDialog from './CsvImportDialog'
import type { BankTxRow } from './types'

interface AccountCard {
  id: string
  accountNumber: string
  accountName: string
  accountType: string
  currency: string
  bookBalance: number
  bankBalance: number
  transactionCount: number
}

interface Props {
  currentAccount: {
    id: string
    glAccountNumber: string
    glAccountName: string
    currency: string
    accountType: string
    bankBalance: number
    bookBalance: number
    totalTransactions: number
  }
  allAccounts: AccountCard[]
  tabCounts: { pending: number; posted: number; excluded: number }
  glAccounts: Array<{ id: string; accountNumber: string; accountName: string; accountClass: string; currency: string }>
  vendors: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string; groupName: string; glAccountId: string | null }>
  taxCodes: Array<{ id: string; code: string; name: string; rate: number; appliesTo: string }>
  openInvoices: Array<{
    id: string
    invoiceNumber: string
    clientName: string
    dateIssued: string
    total: number
    amountDue: number
    currency: string
  }>
  recentExpenses: Array<{
    id: string
    date: string
    description: string
    total: number
    currency: string
  }>
  clearedPayments: Array<{
    id: string
    invoiceNumber: string
    clientName: string
    paymentDate: string
    amount: number
    currency: string
    cadAmount: number
  }>
}

type Tab = 'pending' | 'posted' | 'excluded'

export default function BankAccountTransactionsClient({
  currentAccount,
  allAccounts,
  tabCounts: initialCounts,
  glAccounts,
  vendors,
  categories,
  taxCodes,
  openInvoices,
  recentExpenses,
  clearedPayments,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('pending')
  const [tabCounts, setTabCounts] = useState(initialCounts)
  const [rows, setRows] = useState<BankTxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [drawerData, setDrawerData] = useState<DrawerData | null>(null)

  // Bulk select / categorize (pending tab only)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkTaxCodeId, setBulkTaxCodeId] = useState('')
  const [bulkVendorId, setBulkVendorId] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')

  async function refresh() {
    setLoading(true)
    try {
      const sp = new URLSearchParams({
        accountId: currentAccount.id,
        status: tab,
        limit: '200',
      })
      if (search.trim()) sp.set('search', search.trim())
      const res = await fetch(`/api/bank-transactions?${sp}`)
      const data = await res.json()
      setRows(data.data || [])
      if (data.counts) setTabCounts(data.counts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    setSelected(new Set())
    setBulkMsg('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, currentAccount.id])

  function openCategorize(tx: BankTxRow) {
    setDrawerData({ tx, mode: 'categorize' })
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => {
      if (prev.size === rows.length && rows.length > 0) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }

  // GL accounts grouped by class for the bulk category picker (mirrors the drawer).
  const glByClass = glAccounts.reduce((acc, g) => {
    ;(acc[g.accountClass] ||= []).push(g)
    return acc
  }, {} as Record<string, typeof glAccounts>)

  async function runBulkCategorize() {
    if (!bulkCategoryId || selected.size === 0) return
    setBulkBusy(true)
    setBulkMsg('')
    try {
      const res = await fetch('/api/bank-transactions/bulk-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selected),
          categoryGlAccountId: bulkCategoryId,
          // Only send taxCodeId when the user explicitly picked one; omitting the
          // key lets each tx fall back to the GL account's default tax code.
          ...(bulkTaxCodeId ? { taxCodeId: bulkTaxCodeId } : {}),
          ...(bulkVendorId ? { vendorId: bulkVendorId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBulkMsg(data.error || 'Bulk categorize failed')
        return
      }
      const { succeeded = 0, failed = 0, results = [] } = data
      if (failed > 0) {
        const firstErr = (results as Array<{ ok: boolean; error?: string }>).find((r) => !r.ok)?.error
        setBulkMsg(
          `Categorized ${succeeded}, skipped ${failed}${firstErr ? ` — ${firstErr}` : ''}`
        )
      } else {
        setBulkMsg(`Categorized ${succeeded} transaction${succeeded === 1 ? '' : 's'}`)
      }
      setSelected(new Set())
      setBulkCategoryId('')
      setBulkTaxCodeId('')
      setBulkVendorId('')
      await refresh()
      router.refresh()
    } catch {
      setBulkMsg('Bulk categorize failed')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <>
      {/* Account cards row — horizontally scrollable */}
      <div className="mb-4 flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {allAccounts.map((a) => {
          const isCurrent = a.id === currentAccount.id
          const off = Math.abs(a.bookBalance - a.bankBalance) >= 0.01
          return (
            <Link
              key={a.id}
              href={`/banking/${a.id}`}
              className={`flex-shrink-0 w-[260px] rounded-lg border p-3 transition-all ${
                isCurrent
                  ? 'border-[#0075DD] bg-[#F0F8FE] shadow-sm'
                  : 'border-[#E1E6EB] bg-white hover:border-[#B5C0CC]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-[#576981] font-mono truncate">{a.accountNumber}</div>
                  <div className="text-sm font-semibold text-[#001B40] truncate">{a.accountName}</div>
                </div>
                <span
                  className="px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded flex-shrink-0"
                  style={{
                    backgroundColor: a.accountType === 'credit_card' ? '#FBE7E1' : '#E6F4EA',
                    color: a.accountType === 'credit_card' ? '#BF2600' : '#216E39',
                  }}
                >
                  {a.accountType.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div className="text-[#576981] uppercase">Book</div>
                  <div className="font-semibold text-[#001B40]">
                    {formatCurrency(a.bookBalance, a.currency, { includeCode: false })}
                  </div>
                </div>
                <div>
                  <div className="text-[#576981] uppercase">Reconciled</div>
                  <div className={`font-semibold ${off ? 'text-[#BF2600]' : 'text-[#001B40]'}`}>
                    {formatCurrency(a.bankBalance, a.currency, { includeCode: false })}
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Tabs + actions */}
      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-[#E1E6EB]">
          <div className="flex">
            {(['pending', 'posted', 'excluded'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                  tab === t
                    ? 'text-[#0075DD] border-[#0075DD]'
                    : 'text-[#576981] border-transparent hover:text-[#001B40]'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}{' '}
                <span className="text-xs text-[#8C9BAB]">({tabCounts[t]})</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-4 py-2 lg:py-0">
            <div className="relative">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && refresh()}
                placeholder="Search description"
                className="w-56 pl-7 pr-3 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
              />
              <svg className="w-3.5 h-3.5 text-[#8C9BAB] absolute left-2 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              onClick={() => setImportOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
            >
              Import CSV
            </button>
            <Link
              href="/banking/rules"
              className="px-3 py-1.5 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
            >
              Rules
            </Link>
          </div>
        </div>

        {/* Bulk categorize bar — pending tab, when rows are selected */}
        {tab === 'pending' && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[#E1E6EB] bg-[#F0F8FE] px-4 py-2.5">
            <span className="text-sm font-medium text-[#001B40]">
              {selected.size} selected
            </span>
            <span className="text-[#B5C0CC]">·</span>
            <select
              value={bulkCategoryId}
              onChange={(e) => setBulkCategoryId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-[#E1E6EB] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            >
              <option value="">Select category…</option>
              {Object.entries(glByClass).map(([cls, accts]) => (
                <optgroup key={cls} label={cls.charAt(0).toUpperCase() + cls.slice(1)}>
                  {accts.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.accountNumber} · {g.accountName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={bulkTaxCodeId}
              onChange={(e) => setBulkTaxCodeId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-[#E1E6EB] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            >
              <option value="">Default tax</option>
              {taxCodes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({(t.rate * 100).toFixed(t.rate * 100 % 1 === 0 ? 0 : 2)}%)
                </option>
              ))}
            </select>
            <select
              value={bulkVendorId}
              onChange={(e) => setBulkVendorId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-[#E1E6EB] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            >
              <option value="">No vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <button
              onClick={runBulkCategorize}
              disabled={!bulkCategoryId || bulkBusy}
              className="px-3 py-1.5 text-sm font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkBusy ? 'Categorizing…' : 'Categorize selected'}
            </button>
            <button
              onClick={() => {
                setSelected(new Set())
                setBulkMsg('')
              }}
              className="px-2 py-1.5 text-sm text-[#576981] hover:text-[#001B40]"
            >
              Clear
            </button>
            {bulkMsg && <span className="text-xs text-[#576981]">{bulkMsg}</span>}
          </div>
        )}
        {tab === 'pending' && selected.size === 0 && bulkMsg && (
          <div className="border-b border-[#E1E6EB] bg-[#E6F4EA] px-4 py-2 text-xs text-[#216E39]">
            {bulkMsg}
          </div>
        )}

        {loading ? (
          <div className="p-12 text-center text-sm text-[#576981]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-[#576981] mb-2">
              No {tab} transactions.
            </p>
            {tab === 'pending' && (
              <button
                onClick={() => setImportOpen(true)}
                className="text-sm text-[#0075DD] hover:underline"
              >
                + Import a CSV from your bank
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px]">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    {tab === 'pending' ? (
                      <input
                        type="checkbox"
                        className="rounded border-[#E1E6EB]"
                        checked={rows.length > 0 && selected.size === rows.length}
                        ref={(el) => {
                          if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length
                        }}
                        onChange={toggleAll}
                      />
                    ) : null}
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Date</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Description</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">Spent</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">Received</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Category / Match</th>
                  <th className="w-32 px-3 py-2.5 text-center text-xs font-semibold text-[#576981]">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOut = Number(r.amount) < 0
                  const abs = Math.abs(Number(r.amount))
                  return (
                    <tr key={r.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                      <td className="px-3 py-2.5">
                        {tab === 'pending' ? (
                          <input
                            type="checkbox"
                            className="rounded border-[#E1E6EB]"
                            checked={selected.has(r.id)}
                            onChange={() => toggleRow(r.id)}
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-[#001B40] whitespace-nowrap">
                        {r.transactionDate.slice(0, 10)}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-[#001B40]">
                        <div className="truncate max-w-[260px]" title={r.description}>{r.description}</div>
                        {r.payee && <div className="text-xs text-[#576981] truncate">{r.payee}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-right font-mono text-[#BF2600]">
                        {isOut ? formatCurrency(abs, currentAccount.currency, { includeCode: false }) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-right font-mono text-[#216E39]">
                        {!isOut ? formatCurrency(abs, currentAccount.currency, { includeCode: false }) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[#576981]">
                        {r.matchedInvoiceId
                          ? '↪ Linked to invoice'
                          : r.matchedExpenseId
                          ? '↪ Linked to expense'
                          : r.matchedPaymentId
                          ? '↪ Linked to payment'
                          : r.categoryGlAccountId
                          ? glAccounts.find((g) => g.id === r.categoryGlAccountId)?.accountName || ''
                          : ''}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {tab === 'pending' ? (
                          <button
                            onClick={() => openCategorize(r)}
                            className="px-2 py-1 text-xs font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded"
                          >
                            Categorize
                          </button>
                        ) : tab === 'posted' ? (
                          <button
                            onClick={() => openCategorize(r)}
                            className="text-xs text-[#0075DD] hover:underline"
                          >
                            View
                          </button>
                        ) : (
                          <button
                            onClick={() => openCategorize(r)}
                            className="text-xs text-[#0075DD] hover:underline"
                          >
                            Restore
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerData && (
        <CategorizeDrawer
          data={drawerData}
          currentAccount={currentAccount}
          glAccounts={glAccounts}
          vendors={vendors}
          categories={categories}
          taxCodes={taxCodes}
          openInvoices={openInvoices}
          recentExpenses={recentExpenses}
          clearedPayments={clearedPayments}
          bankAccounts={allAccounts}
          onClose={() => setDrawerData(null)}
          onSaved={() => {
            setDrawerData(null)
            refresh()
            router.refresh()
          }}
        />
      )}

      <CsvImportDialog
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        bankAccountId={currentAccount.id}
        currency={currentAccount.currency}
        accountType={currentAccount.accountType}
        onImported={() => {
          setImportOpen(false)
          refresh()
          router.refresh()
        }}
      />
    </>
  )
}
