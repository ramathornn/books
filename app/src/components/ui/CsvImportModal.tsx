'use client'

import { useRef, useState } from 'react'
import Modal from './Modal'
import { parseCsv } from '@/lib/csv'

interface ImportError {
  row: number
  message: string
}

interface ImportResult {
  imported: number
  errors: ImportError[]
}

interface Props {
  title: string
  sampleColumns: string[]
  onClose: () => void
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>
}

export default function CsvImportModal({
  title,
  sampleColumns,
  onClose,
  onImport,
}: Props) {
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const sampleSet = new Set(sampleColumns.map((c) => c.toLowerCase().trim()))
  const matchedHeaders = headers.filter((h) =>
    sampleSet.has(h.toLowerCase().trim())
  )
  const unmatchedHeaders = headers.filter(
    (h) => !sampleSet.has(h.toLowerCase().trim())
  )

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setResult(null)
    setParseError('')
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      if (parsed.headers.length === 0) {
        setParseError('CSV appears to be empty.')
        setHeaders([])
        setRows([])
        return
      }
      setHeaders(parsed.headers)
      setRows(parsed.rows)
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Failed to parse CSV file.'
      )
    }
  }

  async function handleImport() {
    if (rows.length === 0 || importing) return
    setImporting(true)
    try {
      const r = await onImport(rows)
      setResult(r)
    } catch (err) {
      setResult({
        imported: 0,
        errors: [
          {
            row: 0,
            message: err instanceof Error ? err.message : 'Import failed',
          },
        ],
      })
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setHeaders([])
    setRows([])
    setFileName('')
    setResult(null)
    setParseError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const previewRows = rows.slice(0, 20)

  return (
    <Modal isOpen={true} onClose={onClose} title={title}>
      <div className="space-y-4">
        {!result && (
          <>
            <div>
              <p className="text-sm text-gray-600 mb-2">
                Expected columns (case-insensitive):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sampleColumns.map((c) => (
                  <span
                    key={c}
                    className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Choose CSV file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFile}
                className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:text-sm file:font-medium file:text-[#001B40] hover:file:bg-gray-50"
              />
              {fileName && (
                <p className="mt-1 text-xs text-gray-500">
                  Selected: {fileName} ({rows.length} row{rows.length === 1 ? '' : 's'})
                </p>
              )}
              {parseError && (
                <p className="mt-1 text-xs text-red-600">{parseError}</p>
              )}
            </div>

            {headers.length > 0 && (
              <>
                {unmatchedHeaders.length > 0 && (
                  <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    <strong>Unrecognized columns:</strong>{' '}
                    {unmatchedHeaders.join(', ')} — these will be ignored.
                  </div>
                )}
                {matchedHeaders.length > 0 && (
                  <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">
                    <strong>Matched:</strong> {matchedHeaders.join(', ')}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">
                    Preview (first {Math.min(20, rows.length)} of {rows.length})
                  </p>
                  <div className="border border-gray-200 rounded overflow-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {headers.map((h) => (
                            <th
                              key={h}
                              className="px-2 py-1.5 text-left font-medium text-gray-700 whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((r, i) => (
                          <tr
                            key={i}
                            className="border-t border-gray-100"
                          >
                            {headers.map((h) => (
                              <td
                                key={h}
                                className="px-2 py-1 text-gray-700 whitespace-nowrap max-w-[180px] overflow-hidden text-ellipsis"
                              >
                                {r[h] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={rows.length === 0 || importing}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0075DD] rounded-md hover:bg-[#005bb0] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'Importing...' : `Import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
              Imported <strong>{result.imported}</strong> record
              {result.imported === 1 ? '' : 's'} successfully.
            </div>

            {result.errors.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  {result.errors.length} issue
                  {result.errors.length === 1 ? '' : 's'}:
                </p>
                <div className="border border-gray-200 rounded overflow-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-700 w-16">
                          Row
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-700">
                          Message
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((err, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1 text-gray-700">
                            {err.row || '—'}
                          </td>
                          <td className="px-2 py-1 text-gray-700">
                            {err.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <button
                type="button"
                onClick={reset}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Import another
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-[#001B40] rounded-md hover:bg-[#002D79]"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
