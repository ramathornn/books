'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import PrimaryButton from '@/components/ui/PrimaryButton'
import { toast } from '@/lib/toast'

interface FolderRow {
  id: string
  name: string
}
interface FileRow {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  expenseId?: string | null
}
type Target =
  | { kind: 'folder'; id: string; name: string }
  | { kind: 'file'; id: string; name: string }
interface FolderNode {
  id: string
  name: string
  parentId: string | null
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function FolderIcon() {
  return (
    <svg className="w-6 h-6 text-[#0075DD]" fill="currentColor" viewBox="0 0 24 24">
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
    </svg>
  )
}
function FileIcon() {
  return (
    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M7 3h7l5 5v13a0 0 0 0 1 0 0H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" strokeLinejoin="round" />
      <path d="M14 3v5h5" strokeLinejoin="round" />
    </svg>
  )
}

export default function FilesExplorer({
  currentFolderId,
  breadcrumbs,
  folders,
  files,
}: {
  currentFolderId: string | null
  breadcrumbs: { id: string; name: string }[]
  folders: FolderRow[]
  files: FileRow[]
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  const [renameTarget, setRenameTarget] = useState<Target | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Target | null>(null)
  const [uploading, setUploading] = useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  // Sidebar file preview — track by id so renames/moves/deletes stay in sync
  // with the server-refreshed list (a moved/deleted file simply closes the panel).
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewFile = files.find((f) => f.id === previewId) ?? null

  // Move-to-folder
  const [moveTarget, setMoveTarget] = useState<Target | null>(null)
  const [folderTree, setFolderTree] = useState<FolderNode[]>([])
  const [moveDest, setMoveDest] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  // Drag-and-drop upload
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)

  function navigate(folderId: string | null) {
    router.push(folderId ? `/files?folder=${folderId}` : '/files')
  }

  async function openMove(target: Target) {
    setMoveTarget(target)
    setMoveDest(currentFolderId)
    try {
      const res = await fetch('/api/files/folders')
      const data = await res.json().catch(() => ({}))
      if (res.ok) setFolderTree(data.data || [])
    } catch {
      /* picker still works with just Home */
    }
  }

  async function doMove() {
    if (!moveTarget || moving) return
    setMoving(true)
    try {
      const url =
        moveTarget.kind === 'folder'
          ? `/api/files/folders/${moveTarget.id}`
          : `/api/files/${moveTarget.id}`
      const body =
        moveTarget.kind === 'folder' ? { parentId: moveDest } : { folderId: moveDest }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Move failed')
      toast.success('Moved')
      setMoveTarget(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Move failed')
    } finally {
      setMoving(false)
    }
  }

  async function createFolder() {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/files/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName, parentId: currentFolderId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create folder')
      toast.success('Folder created')
      setNewFolderOpen(false)
      setNewFolderName('')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create folder')
    } finally {
      setCreating(false)
    }
  }

  async function uploadFiles(list: FileList) {
    setUploading(true)
    let ok = 0
    let failed = 0
    for (const file of Array.from(list)) {
      const form = new FormData()
      form.append('file', file)
      if (currentFolderId) form.append('folderId', currentFolderId)
      try {
        const res = await fetch('/api/files', { method: 'POST', body: form })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Upload failed')
        }
        ok++
      } catch (e) {
        failed++
        toast.error(`${file.name}: ${e instanceof Error ? e.message : 'Upload failed'}`)
      }
    }
    setUploading(false)
    if (ok) toast.success(`Uploaded ${ok} file${ok > 1 ? 's' : ''}`)
    if (ok || failed) router.refresh()
  }

  async function doRename() {
    if (!renameTarget || renaming) return
    setRenaming(true)
    try {
      const url =
        renameTarget.kind === 'folder'
          ? `/api/files/folders/${renameTarget.id}`
          : `/api/files/${renameTarget.id}`
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Rename failed')
      toast.success('Renamed')
      setRenameTarget(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      setRenaming(false)
    }
  }

  async function doDelete() {
    if (!deleteTarget) return
    const url =
      deleteTarget.kind === 'folder'
        ? `/api/files/folders/${deleteTarget.id}`
        : `/api/files/${deleteTarget.id}`
    try {
      const res = await fetch(url, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      toast.success('Deleted')
      setDeleteTarget(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const isEmpty = folders.length === 0 && files.length === 0

  return (
    <div
      className="relative"
      onClick={() => menuOpen && setMenuOpen(null)}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current += 1
        setDragActive(true)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragActive(false)
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current = 0
        setDragActive(false)
        if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files)
      }}
    >
      {dragActive && (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-[#0075DD] bg-[#0075DD]/5 pointer-events-none">
          <p className="text-[#0075DD] font-medium text-sm">Drop files to upload here</p>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Files
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setNewFolderName('')
              setNewFolderOpen(true)
            }}
            className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-[#001B40] text-sm font-medium rounded inline-flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
              <path d="M12 11v4M10 13h4" strokeLinecap="round" />
            </svg>
            New Folder
          </button>
          <PrimaryButton onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '+ Upload'}
          </PrimaryButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) uploadFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {/* Breadcrumbs */}
      <nav className="flex items-center flex-wrap gap-1 text-sm text-gray-500 mb-4">
        <button onClick={() => navigate(null)} className="hover:text-[#0075DD] font-medium">
          Home
        </button>
        {breadcrumbs.map((b, i) => {
          const last = i === breadcrumbs.length - 1
          return (
            <span key={b.id} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              {last ? (
                <span className="text-[#001B40] font-medium">{b.name}</span>
              ) : (
                <button onClick={() => navigate(b.id)} className="hover:text-[#0075DD]">
                  {b.name}
                </button>
              )}
            </span>
          )
        })}
      </nav>

      {isEmpty ? (
        <div className="border border-dashed border-gray-200 rounded-lg py-20 text-center">
          <div className="flex justify-center mb-3 opacity-40">
            <FolderIcon />
          </div>
          <p className="text-gray-500 text-sm">This folder is empty.</p>
          <p className="text-gray-400 text-xs mt-1">Create a folder or upload files to get started.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 group"
            >
              <button
                onClick={() => navigate(folder.id)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <FolderIcon />
                <span className="font-medium text-[#001B40] truncate">{folder.name}</span>
              </button>
              <RowMenu
                id={`folder-${folder.id}`}
                open={menuOpen === `folder-${folder.id}`}
                setOpen={setMenuOpen}
                onRename={() => {
                  setRenameTarget({ kind: 'folder', id: folder.id, name: folder.name })
                  setRenameValue(folder.name)
                }}
                onMove={() => openMove({ kind: 'folder', id: folder.id, name: folder.name })}
                onDelete={() => setDeleteTarget({ kind: 'folder', id: folder.id, name: folder.name })}
              />
            </div>
          ))}

          {files.map((file) => (
            <div
              key={file.id}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 group ${
                previewFile?.id === file.id ? 'bg-[#0075DD]/5' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => setPreviewId(file.id)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <FileIcon />
                <span className="text-[#001B40] truncate">{file.name}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(file.sizeBytes)}</span>
              </button>
              {file.expenseId && (
                <Link
                  href={`/expenses/${file.expenseId}`}
                  onClick={(e) => e.stopPropagation()}
                  title="Linked to an expense — open it"
                  className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0075DD]/10 text-[#0075DD] text-xs font-medium hover:bg-[#0075DD]/20"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" strokeLinecap="round" />
                  </svg>
                  Expense
                </Link>
              )}
              <RowMenu
                id={`file-${file.id}`}
                open={menuOpen === `file-${file.id}`}
                setOpen={setMenuOpen}
                downloadHref={`/api/files/${file.id}/content?download=1`}
                onRename={() => {
                  setRenameTarget({ kind: 'file', id: file.id, name: file.name })
                  setRenameValue(file.name)
                }}
                onMove={() => openMove({ kind: 'file', id: file.id, name: file.name })}
                onDelete={() => setDeleteTarget({ kind: 'file', id: file.id, name: file.name })}
              />
            </div>
          ))}
        </div>
      )}

      {/* New Folder modal */}
      <Modal isOpen={newFolderOpen} onClose={() => setNewFolderOpen(false)} title="New Folder">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createFolder()
          }}
        >
          <label className="block text-sm font-medium text-gray-700 mb-1">Folder name</label>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Untitled folder"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/40"
          />
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setNewFolderOpen(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" disabled={creating || !newFolderName.trim()}>
              {creating ? 'Creating…' : 'Create'}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* Rename modal */}
      <Modal isOpen={!!renameTarget} onClose={() => setRenameTarget(null)} title="Rename">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            doRename()
          }}
        >
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/40"
          />
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" disabled={renaming || !renameValue.trim()}>
              {renaming ? 'Saving…' : 'Save'}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={deleteTarget?.kind === 'folder' ? 'Delete folder' : 'Delete file'}
        message={
          deleteTarget?.kind === 'folder'
            ? `Delete "${deleteTarget?.name}" and everything inside it? This cannot be undone.`
            : `Delete "${deleteTarget?.name}"? This cannot be undone.`
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Move modal */}
      <Modal isOpen={!!moveTarget} onClose={() => setMoveTarget(null)} title={`Move "${moveTarget?.name ?? ''}"`}>
        <p className="text-sm text-gray-500 mb-3">Choose a destination folder.</p>
        <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
          <FolderPickerRow
            label="Home"
            depth={0}
            selected={moveDest === null}
            disabled={false}
            onSelect={() => setMoveDest(null)}
          />
          {orderFolderTree(
            folderTree,
            moveTarget?.kind === 'folder' ? moveTarget.id : null
          ).map((node) => (
            <FolderPickerRow
              key={node.id}
              label={node.name}
              depth={node.depth}
              selected={moveDest === node.id}
              disabled={node.disabled}
              onSelect={() => !node.disabled && setMoveDest(node.id)}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={() => setMoveTarget(null)}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <PrimaryButton onClick={doMove} disabled={moving}>
            {moving ? 'Moving…' : 'Move here'}
          </PrimaryButton>
        </div>
      </Modal>

      {/* File preview sidebar */}
      <FilePreviewSidebar
        file={previewFile}
        onClose={() => setPreviewId(null)}
        onRename={(f) => {
          setRenameTarget({ kind: 'file', id: f.id, name: f.name })
          setRenameValue(f.name)
        }}
        onMove={(f) => openMove({ kind: 'file', id: f.id, name: f.name })}
        onDelete={(f) => setDeleteTarget({ kind: 'file', id: f.id, name: f.name })}
      />
    </div>
  )
}

function FilePreviewSidebar({
  file,
  onClose,
  onRename,
  onMove,
  onDelete,
}: {
  file: FileRow | null
  onClose: () => void
  onRename: (f: FileRow) => void
  onMove: (f: FileRow) => void
  onDelete: (f: FileRow) => void
}) {
  // Close on Escape while the panel is open.
  useEffect(() => {
    if (!file) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [file, onClose])

  if (typeof document === 'undefined') return null

  const open = !!file
  const isImage = !!file && file.mimeType.startsWith('image/')
  const isPdf = file?.mimeType === 'application/pdf'
  const contentUrl = file ? `/api/files/${file.id}/content` : ''

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      {/* Panel */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {file && (
          <>
            <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
              <div className="flex-1 min-w-0">
                <h2 className="font-medium text-[#001B40] truncate" title={file.name}>
                  {file.name}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatBytes(file.sizeBytes)} · {file.mimeType || 'Unknown type'}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close preview"
                className="p-1.5 -mr-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto bg-gray-50 flex items-center justify-center p-4">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contentUrl}
                  alt={file.name}
                  className="max-w-full max-h-full object-contain rounded shadow-sm"
                />
              ) : isPdf ? (
                <iframe
                  src={contentUrl}
                  title={file.name}
                  className="w-full h-full bg-white rounded shadow-sm"
                />
              ) : (
                <div className="text-center px-6">
                  <div className="flex justify-center mb-3 opacity-40">
                    <FileIcon />
                  </div>
                  <p className="text-gray-500 text-sm">No preview available for this file type.</p>
                  <a
                    href={`/api/files/${file.id}/content?download=1`}
                    className="inline-block mt-3 text-sm text-[#0075DD] hover:underline font-medium"
                  >
                    Download to view
                  </a>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100">
              <a
                href={contentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 text-sm text-gray-600 hover:text-[#0075DD] font-medium inline-flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Open
              </a>
              <a
                href={`/api/files/${file.id}/content?download=1`}
                className="px-3 py-2 text-sm text-gray-600 hover:text-[#0075DD] font-medium inline-flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download
              </a>
              <div className="flex-1" />
              <button
                onClick={() => onRename(file)}
                className="px-3 py-2 text-sm text-gray-600 hover:text-[#0075DD] font-medium"
              >
                Rename
              </button>
              <button
                onClick={() => onMove(file)}
                className="px-3 py-2 text-sm text-gray-600 hover:text-[#0075DD] font-medium"
              >
                Move
              </button>
              <button
                onClick={() => onDelete(file)}
                className="px-3 py-2 text-sm text-red-600 hover:text-red-700 font-medium"
              >
                Delete
              </button>
            </div>
          </>
        )}
      </aside>
    </>,
    document.body
  )
}

// Flatten the folder tree into display order (parent before children) with depth
// for indentation. When moving a folder, its whole subtree is disabled so it can't
// be dropped into itself.
function orderFolderTree(
  nodes: FolderNode[],
  excludeSubtreeOf: string | null
): Array<FolderNode & { depth: number; disabled: boolean }> {
  const byParent = new Map<string | null, FolderNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const out: Array<FolderNode & { depth: number; disabled: boolean }> = []
  function walk(parentId: string | null, depth: number, disabledBranch: boolean) {
    for (const n of byParent.get(parentId) ?? []) {
      const disabled = disabledBranch || n.id === excludeSubtreeOf
      out.push({ ...n, depth, disabled })
      walk(n.id, depth + 1, disabled)
    }
  }
  walk(null, 0, false)
  return out
}

function FolderPickerRow({
  label,
  depth,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  depth: number
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      style={{ paddingLeft: `${12 + depth * 18}px` }}
      className={`flex items-center gap-2 w-full text-left pr-3 py-2 text-sm ${
        disabled
          ? 'text-gray-300 cursor-not-allowed'
          : selected
          ? 'bg-[#0075DD]/10 text-[#0075DD] font-medium'
          : 'text-[#001B40] hover:bg-gray-50'
      }`}
    >
      <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
      </svg>
      <span className="truncate">{label}</span>
    </button>
  )
}

function RowMenu({
  id,
  open,
  setOpen,
  onRename,
  onMove,
  onDelete,
  downloadHref,
}: {
  id: string
  open: boolean
  setOpen: (id: string | null) => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  downloadHref?: string
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)

  function toggle() {
    if (open) {
      setOpen(null)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setOpen(id)
  }

  return (
    <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        onClick={toggle}
        aria-label="Actions"
        className="p-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[open=true]:opacity-100"
        data-open={open}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && coords &&
        createPortal(
          <div
            className="fixed z-50 w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm"
            style={{ top: coords.top, right: coords.right }}
          >
            {downloadHref && (
              <a
                href={downloadHref}
                className="block px-3 py-2 text-gray-700 hover:bg-gray-50"
                onClick={() => setOpen(null)}
              >
                Download
              </a>
            )}
            <button
              onClick={() => {
                setOpen(null)
                onRename()
              }}
              className="block w-full text-left px-3 py-2 text-gray-700 hover:bg-gray-50"
            >
              Rename
            </button>
            <button
              onClick={() => {
                setOpen(null)
                onMove()
              }}
              className="block w-full text-left px-3 py-2 text-gray-700 hover:bg-gray-50"
            >
              Move to…
            </button>
            <button
              onClick={() => {
                setOpen(null)
                onDelete()
              }}
              className="block w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
