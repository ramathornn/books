'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

export interface BankingAccount {
  id: string
  glAccountNumber: string
  glAccountName: string
  bankName: string
  accountNumberMasked: string
  accountType: string
  currency: string
  bookBalance: number
  reconciledBalance: number
  transactionCount: number
  lastReconciledAt: string | null
  isLinked: boolean
  plaidCurrentBalance: number | null
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-[#E6F4FE] text-[#0075DD]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#0075DD]" />
      LIVE
    </span>
  )
}

const STORAGE_KEY = 'banking-view-mode'

// Persist in a cookie so the server can render the right view on next load.
function persistView(v: 'tile' | 'table') {
  document.cookie = `${STORAGE_KEY}=${v}; path=/; max-age=31536000; SameSite=Lax`
}

export default function BankingViewClient({
  accounts,
  initialView = 'tile',
}: {
  accounts: BankingAccount[]
  initialView?: 'tile' | 'table'
}) {
  // Initialized from the server-read cookie, so the first paint is already the
  // correct view — no flicker.
  const [view, setView] = useState<'tile' | 'table'>(initialView)

  function changeView(v: 'tile' | 'table') {
    setView(v)
    persistView(v)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#576981]">{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}</span>
        <div className="inline-flex border border-[#E1E6EB] rounded-md p-0.5 bg-white">
          {([
            { v: 'tile' as const, label: 'Tiles', icon: (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" strokeWidth="2" rx="1" />
                <rect x="14" y="3" width="7" height="7" strokeWidth="2" rx="1" />
                <rect x="3" y="14" width="7" height="7" strokeWidth="2" rx="1" />
                <rect x="14" y="14" width="7" height="7" strokeWidth="2" rx="1" />
              </svg>
            )},
            { v: 'table' as const, label: 'Table', icon: (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth="2" d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            )},
          ]).map((opt) => (
            <button
              key={opt.v}
              onClick={() => changeView(opt.v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded transition-colors ${
                view === opt.v
                  ? 'bg-[#0075DD] text-white'
                  : 'text-[#576981] hover:text-[#001B40]'
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'tile' ? <TileView accounts={accounts} /> : <TableView accounts={accounts} />}
    </div>
  )
}

function TileView({ accounts }: { accounts: BankingAccount[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {accounts.map((a) => {
        const showPlaid = a.isLinked && a.plaidCurrentBalance !== null
        const compareBalance = showPlaid ? (a.plaidCurrentBalance as number) : a.reconciledBalance
        const off = Math.abs(a.bookBalance - compareBalance) >= 0.01
        return (
          <Link
            key={a.id}
            href={`/banking/${a.id}`}
            className="bg-white rounded-lg border border-[#E1E6EB] p-4 hover:border-[#0075DD] hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-xs text-[#576981] font-mono">{a.glAccountNumber}</div>
                <div className="font-semibold text-[#001B40] text-sm mt-0.5">{a.glAccountName}</div>
                <div className="text-xs text-[#576981] mt-0.5">
                  {a.bankName}
                  {a.accountNumberMasked && ` · ••${a.accountNumberMasked}`}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded"
                  style={{
                    backgroundColor: a.accountType === 'credit_card' ? '#FBE7E1' : '#E6F4EA',
                    color: a.accountType === 'credit_card' ? '#BF2600' : '#216E39',
                  }}
                >
                  {a.accountType.replace('_', ' ')}
                </span>
                {a.isLinked && <LiveBadge />}
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[#E1E6EB] grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-[#576981] uppercase">Book Balance</div>
                <div className="text-sm font-semibold text-[#001B40]">
                  {formatCurrency(a.bookBalance, a.currency, { includeCode: false })}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#576981] uppercase">
                  {showPlaid ? 'Bank (Plaid)' : 'Reconciled'}
                </div>
                <div className={`text-sm font-semibold ${off ? 'text-[#BF2600]' : 'text-[#001B40]'}`}>
                  {formatCurrency(compareBalance, a.currency, { includeCode: false })}
                </div>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-[#576981]">
              <span>{a.transactionCount} tx</span>
              {a.lastReconciledAt ? (
                <span>Last reconciled {new Date(a.lastReconciledAt).toLocaleDateString()}</span>
              ) : (
                <span className="text-[#BF2600]">Never reconciled</span>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function TableView({ accounts }: { accounts: BankingAccount[] }) {
  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px]">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Number</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Name</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Bank</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Type</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">CCY</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">Book balance</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">Reconciled</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">Tx</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Last reconciled</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const showPlaid = a.isLinked && a.plaidCurrentBalance !== null
              const compareBalance = showPlaid ? (a.plaidCurrentBalance as number) : a.reconciledBalance
              const off = Math.abs(a.bookBalance - compareBalance) >= 0.01
              return (
                <tr key={a.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                  <td className="px-3 py-2.5 text-sm font-mono text-[#576981]">{a.glAccountNumber}</td>
                  <td className="px-3 py-2.5 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <Link href={`/banking/${a.id}`} className="font-medium text-[#0075DD] hover:underline">
                        {a.glAccountName}
                      </Link>
                      {a.isLinked && <LiveBadge />}
                    </span>
                    {a.accountNumberMasked && (
                      <div className="text-xs text-[#576981]">••{a.accountNumberMasked}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-[#001B40]">{a.bankName}</td>
                  <td className="px-3 py-2.5 text-sm">
                    <span
                      className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded"
                      style={{
                        backgroundColor: a.accountType === 'credit_card' ? '#FBE7E1' : '#E6F4EA',
                        color: a.accountType === 'credit_card' ? '#BF2600' : '#216E39',
                      }}
                    >
                      {a.accountType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#576981]">{a.currency}</td>
                  <td className="px-3 py-2.5 text-sm text-right font-mono text-[#001B40]">
                    {formatCurrency(a.bookBalance, a.currency, { includeCode: false })}
                  </td>
                  <td className={`px-3 py-2.5 text-sm text-right font-mono ${off ? 'text-[#BF2600] font-semibold' : 'text-[#001B40]'}`}>
                    {formatCurrency(compareBalance, a.currency, { includeCode: false })}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-right text-[#001B40]">{a.transactionCount}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {a.lastReconciledAt ? (
                      <span className="text-[#576981]">{new Date(a.lastReconciledAt).toLocaleDateString()}</span>
                    ) : (
                      <span className="text-[#BF2600]">Never</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
