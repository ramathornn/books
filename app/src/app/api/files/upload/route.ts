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

// POST /api/files/upload — headless single-file upload.
// multipart/form-data: folder_path (string, slash-separated), file (binary),
// filename (optional display-name override). Missing folders are created
// recursively. Same name in the same folder OVERWRITES the existing file.
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request)
  if (!authResult.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authResult.status })
  }

  // Only attribute uploads to a user when an interactive session is present.
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

  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'file required' }, { status: 400 })
  }

  const filenameOverrideRaw = form.get('filename')
  const filenameOverride =
    typeof filenameOverrideRaw === 'string' && filenameOverrideRaw.trim()
      ? filenameOverrideRaw
      : undefined

  // ---- Validate the file up front (size + mime) ----
  if (file.size === 0) {
    return Response.json({ error: 'File is empty' }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
      { status: 400 }
    )
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json(
      { error: `Unsupported file type: ${file.type || 'unknown'}` },
      { status: 400 }
    )
  }

  // ---- Resolve display name ----
  const nameCheck = validateName(filenameOverride ?? file.name)
  if (!nameCheck.ok) {
    return Response.json({ error: nameCheck.error }, { status: 400 })
  }

  // ---- Resolve / create the folder hierarchy ----
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

  const stored = await storeUploadedFile({
    file,
    displayName: nameCheck.name,
    folderId,
    uploadedById,
  })

  const fullPath = normalizedFolderPath
    ? `${normalizedFolderPath}/${stored.name}`
    : stored.name

  return Response.json(
    { file_id: stored.id, path: fullPath, size: stored.sizeBytes },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  )
}
