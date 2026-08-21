import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'

// The Files manager stores bytes on disk under random names in a flat directory.
// Folders are virtual (DB rows), so the client never supplies a filesystem path
// and path traversal is impossible by construction.

// Reuse the same env override as attachments so prod can relocate the upload root.
function uploadRoot(): string {
  return process.env.UPLOAD_ROOT || path.resolve(process.cwd(), 'uploads')
}

function filesDir(): string {
  return path.join(uploadRoot(), 'files')
}

export async function ensureFilesDir(): Promise<string> {
  const dir = filesDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

// Generate the on-disk storage path for a freshly uploaded file. The name is a
// random UUID + a sanitized extension — never derived from user input beyond ext.
export function newStoragePath(originalName: string): { storagePath: string; ext: string } {
  const rawExt = path.extname(originalName).toLowerCase()
  // Only keep a short, alphanumeric extension; otherwise drop it.
  const ext = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : ''
  const safeName = `${crypto.randomUUID()}${ext}`
  return { storagePath: path.posix.join('files', safeName), ext }
}

// Resolve a stored relative path to an absolute one, refusing anything that
// escapes the upload root (defense in depth — paths are server-generated).
export function absolutePath(storagePath: string): string {
  const root = uploadRoot()
  const full = path.resolve(root, storagePath)
  const rel = path.relative(root, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes upload root')
  }
  return full
}

// Broad but safe allowlist. Deliberately excludes executables and active content
// (text/html, image/svg+xml, application/x-* binaries) to avoid stored-XSS and
// drive-by execution. Anything outside this set is rejected at upload.
export const ALLOWED_MIME = new Set<string>([
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf',
  // Text / data
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  // Archives
  'application/zip',
])

// Types we trust to render inline in the browser. Everything else is forced to
// download via Content-Disposition: attachment.
export const INLINE_MIME = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
export const MAX_NAME_LENGTH = 200

// Validate a user-supplied display name (for folders and renames). Disallows
// path separators and control characters; allows spaces, dots, parentheses, etc.
export function validateName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Name is required' }
  const name = raw.trim()
  if (!name) return { ok: false, error: 'Name cannot be empty' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Name too long (max ${MAX_NAME_LENGTH})` }
  if (/[/\\\x00-\x1f]/.test(name)) return { ok: false, error: 'Name contains invalid characters' }
  if (name === '.' || name === '..') return { ok: false, error: 'Invalid name' }
  return { ok: true, name }
}
