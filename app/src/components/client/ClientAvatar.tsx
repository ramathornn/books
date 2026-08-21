'use client'

const PALETTE = [
  '#0075DD',
  '#2FA84F',
  '#F0627E',
  '#8B4513',
  '#FFB020',
  '#6B46C1',
  '#0891B2',
  '#DC2626',
] as const

export function getClientInitials(c: {
  organization?: string
  firstName?: string
  lastName?: string
}): string {
  const org = (c.organization || '').trim()
  const first = (c.firstName || '').trim()
  const last = (c.lastName || '').trim()

  // Prefer first+last if both exist
  if (first && last) {
    return (first[0] + last[0]).toUpperCase()
  }

  if (org) {
    const parts = org.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase()
    }
  }

  if (first) return first.substring(0, 2).toUpperCase()
  if (last) return last.substring(0, 2).toUpperCase()
  return '??'
}

export function getClientColor(id: string): string {
  if (!id) return PALETTE[0]
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

interface ClientAvatarProps {
  id: string
  organization?: string
  firstName?: string
  lastName?: string
  size?: number
}

export default function ClientAvatar({
  id,
  organization,
  firstName,
  lastName,
  size = 32,
}: ClientAvatarProps) {
  const initials = getClientInitials({ organization, firstName, lastName })
  const color = getClientColor(id)
  const fontSize = Math.max(10, Math.round(size * 0.375))
  return (
    <div
      className="inline-flex items-center justify-center rounded-full bg-white flex-shrink-0"
      style={{
        width: size,
        height: size,
        border: `2px solid ${color}`,
      }}
      aria-hidden="true"
    >
      <span
        className="font-semibold"
        style={{ color: '#001B40', fontSize }}
      >
        {initials}
      </span>
    </div>
  )
}
