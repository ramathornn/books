import crypto from 'node:crypto'

// AES-256-GCM symmetric encryption for secrets at rest (Plaid access tokens).
// Key comes from ENCRYPTION_KEY (64 hex chars = 32 bytes). Output is a single
// compact string `iv:authTag:ciphertext` (all hex) so it fits one DB column.

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY || ''
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  }
  return key
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12) // 96-bit nonce (GCM standard)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, ctHex] = payload.split(':')
  if (!ivHex || !tagHex || !ctHex) throw new Error('Malformed encrypted payload')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return (
    decipher.update(Buffer.from(ctHex, 'hex')).toString('utf8') + decipher.final('utf8')
  )
}
