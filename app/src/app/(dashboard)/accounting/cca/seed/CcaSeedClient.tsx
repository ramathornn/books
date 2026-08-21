'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface ClassOpt {
  id: string
  classNumber: string
  description: string
  rate: number
}

const inputCls =
  'h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

const money = (n: number) => formatCurrency(n, 'CAD', { includeCode: false })

export default function CcaSeedClient({ classes }: { classes: ClassOpt[] }) {
  const router = useRouter()
  const [classId, setClassId] = useState(classes[0]?.id ?? '')
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear() - 1))
  const [openingUcc, setOpeningUcc] = useState('')
  const [additions, setAdditions] = useState('')
  const [dispositions, setDispositions] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ ccaClaimed: number; closingUcc: number } | null>(null)

  if (classes.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-[#E1E6EB] p-8 text-center text-sm text-[#576981]">
        No classes yet. <Link href="/accounting/cca/setup" className="text-[#0075DD] hover:underline">Set up a class</Link> first.
      </div>
    )
  }

  async function seed() {
    setSaving(true)
    setError('')
    setDone(null)
    try {
      const res = await fetch('/api/cca/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          taxYear: parseInt(taxYear, 10),
          openingUcc: parseFloat(openingUcc || '0'),
          additions: parseFloat(additions || '0'),
          dispositions: parseFloat(dispositions || '0'),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to seed')
      setDone({ ccaClaimed: d.result.ccaClaimed, closingUcc: d.result.closingUcc })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {error && <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}
      {done && (
        <div className="p-3 bg-[#E3FCEF] text-[#006644] text-sm rounded">
          Seeded. First-year CCA {money(done.ccaClaimed)}, closing UCC {money(done.closingUcc)}.{' '}
          <Link href="/accounting/cca" className="underline">View grid</Link>
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5 space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-[#576981] mb-1">Class</span>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={inputCls + ' w-full'}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                Class {c.classNumber} · {c.description} ({(c.rate * 100).toFixed(2)}%)
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Starting tax year</span>
            <input
              type="number"
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              className={inputCls + ' w-full text-right font-mono'}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Opening UCC</span>
            <input
              type="number"
              value={openingUcc}
              onChange={(e) => setOpeningUcc(e.target.value)}
              className={inputCls + ' w-full text-right font-mono'}
              placeholder="0.00"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Additions this year</span>
            <input
              type="number"
              value={additions}
              onChange={(e) => setAdditions(e.target.value)}
              className={inputCls + ' w-full text-right font-mono'}
              placeholder="0.00"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Dispositions this year</span>
            <input
              type="number"
              value={dispositions}
              onChange={(e) => setDispositions(e.target.value)}
              className={inputCls + ' w-full text-right font-mono'}
              placeholder="0.00"
            />
          </label>
        </div>

        <button
          onClick={seed}
          disabled={saving || !classId || !taxYear}
          className="px-5 py-2 bg-[#0075DD] hover:bg-[#005FB3] text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {saving ? 'Seeding…' : 'Seed opening UCC'}
        </button>
      </div>
    </div>
  )
}
