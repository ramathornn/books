import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import {
  resolveFolderPath,
  storeUploadedFile,
  FolderPathError,
} from '@/lib/fileUpload'
import { validateName, ALLOWED_MIME, MAX_FILE_SIZE } from '@/lib/files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/files/upload-bulk — headless multi-file upload into one folder_path.
// multipart/form-data: folder_path (string) + files[] (repeated). Per-file
// try/catch so one bad file doesn't fail the batch. Missing folders are created
// once up front; same-name collisions overwrite (see storeUploadedFile).
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request)
  if (!authResult.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authResult.status })
  }

  const session = authResult.via === 'session' ? await auth() : null
  const uploadedById = (session?.user as { id?: string } | undefined)?.id ?? null

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const folderPathRaw = form.get('folder_path')
  if (typeof folderPathRaw !== 'string') {
    return Response.json({ error: 'folder_path required' }, { status: 400 })
  }

  // Accept files under both "files" (repeated) and "files[]".
  const entries = [...form.getAll('files'), ...form.getAll('files[]')]
  const files = entries.filter((e): e is File => e instanceof File)
  if (files.length === 0) {
    return Response.json({ error: 'files required' }, { status: 400 })
  }

  // Resolve / create the folder hierarchy once for the whole batch.
  let folderId: string | null
  let normalizedFolderPath: string
  try {
    const resolved = await resolveFolderPath(folderPathRaw, uploadedById)
    folderId = resolved.folderId
    normalizedFolderPath = resolved.normalizedPath
  } catch (err) {
    if (err instanceof FolderPathError) {
      return Response.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  const uploaded: { file_id: string; path: string }[] = []
  const failed: { filename: string; error: string }[] = []

  for (const file of files) {
    const label = file.name || 'unnamed'
    try {
      if (file.size === 0) throw new Error('File is empty')
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`)
      }
      if (!ALLOWED_MIME.has(file.type)) {
        throw new Error(`Unsupported file type: ${file.type || 'unknown'}`)
      }
      const nameCheck = validateName(file.name)
      if (!nameCheck.ok) throw new Error(nameCheck.error)

      const stored = await storeUploadedFile({
        file,
        displayName: nameCheck.name,
        folderId,
        uploadedById,
      })
      const fullPath = normalizedFolderPath
        ? `${normalizedFolderPath}/${stored.name}`
        : stored.name
      uploaded.push({ file_id: stored.id, path: fullPath })
    } catch (err) {
      failed.push({
        filename: label,
        error: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  return Response.json(
    { uploaded, failed },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  )
}
