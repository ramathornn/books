import crypto from 'node:crypto'

/**
 * Social Insurance Number (SIN) handling: AES-256-GCM at-rest encryption,
 * Luhn validation, and display masking.
 *
 * SINs are sensitive PII subject to CRA handling rules. They are NEVER stored in
 * plaintext, NEVER written to FilingExport payloads, and excluded from the
 * audit snapshot. The encryption key is its own env var `TAX_SIN_KEY` (64 hex
 * chars = 32 bytes), distinct from the Plaid `ENCRYPTION_KEY`, so SIN access can
 * be key-rotated independently (CompanySettings.sinEncryptionKeyVersion).
 *
 * Cipher format mirrors src/lib/crypto.ts: `iv:authTag:ciphertext` (all hex),
 * one compact column value.
 *
 * Pure crypto + arithmetic; no DB I/O.
 */

function getSinKey(): Buffer {
  const hex = process.env.TAX_SIN_KEY || ''
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) {
    throw new Error('TAX_SIN_KEY must be 32 bytes (64 hex chars)')
  }
  return key
}

/** Strip spaces/dashes; keep digits only. */
export function normalizeSin(raw: string): string {
  return (raw || '').replace(/\D/g, '')
}

/**
 * Validate a 9-digit SIN by the Luhn checksum. Returns false for wrong length
 * or failed checksum. (Does not reject by leading digit / province ranges —
 * those are softer rules surfaced as warnings elsewhere.)
 */
export function isValidSin(raw: string): boolean {
  const digits = normalizeSin(raw)
  if (digits.length !== 9) return false
  return luhnValid(digits)
}

/** Generic Luhn check over a digit string (also reused by BN check digits). */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  let dbl = false
  // Process right-to-left, doubling every second digit.
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

/** Last 3 digits, for non-reversible display masking persisted alongside cipher. */
export function sinLast3(raw: string): string {
  const digits = normalizeSin(raw)
  return digits.slice(-3)
}

/** Mask for display: "***-**-X123" style → "•••-••-123". */
export function maskSin(raw: string): string {
  const last3 = sinLast3(raw)
  if (!last3) return ''
  return `•••-••-${last3}`
}

/** Encrypt a SIN for storage. Validates Luhn first; throws on invalid input. */
export function encryptSin(raw: string): string {
  const digits = normalizeSin(raw)
  if (!isValidSin(digits)) throw new Error('Invalid SIN (failed Luhn / length check)')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getSinKey(), iv)
  const ct = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

/**
 * Decrypt a stored SIN cipher back to its 9-digit plaintext. Authorized,
 * permission-gated callers only (XML regeneration on download). Throws on a
 * malformed or tampered payload.
 */
export function decryptSin(payload: string): string {
  const [ivHex, tagHex, ctHex] = (payload || '').split(':')
  if (!ivHex || !tagHex || !ctHex) throw new Error('Malformed SIN cipher payload')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getSinKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(ctHex, 'hex')).toString('utf8') + decipher.final('utf8')
}
