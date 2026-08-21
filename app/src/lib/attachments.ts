import path from 'node:path'
import fs from 'node:fs/promises'

export const ENTITY_TYPES = [
  'invoice',
  'expense',
  'journal_entry',
  'bank_transaction',
  'bill',
  'vendor',
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

export function isValidEntityType(t: string): t is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(t)
}

// Allow override via env so prod can use a separate upload root, but default to next to the app.
function uploadRoot(): string {
  return process.env.UPLOAD_ROOT || path.resolve(process.cwd(), 'uploads')
}

export function entityDir(entityType: EntityType, entityId: string): string {
  return path.join(uploadRoot(), entityType, entityId)
}

export async function ensureEntityDir(entityType: EntityType, entityId: string): Promise<string> {
  const dir = entityDir(entityType, entityId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export function relativeStoragePath(entityType: EntityType, entityId: string, fileName: string) {
  return `${entityType}/${entityId}/${fileName}`
}

export function absolutePath(storagePath: string): string {
  return path.join(uploadRoot(), storagePath)
}

export const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
])

export const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB
