import 'dotenv/config'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import * as readline from 'node:readline/promises'
import { createInterface as createInterfaceCb } from 'node:readline'
import { stdin, stdout } from 'node:process'
import bcrypt from 'bcryptjs'

const APP_DIR = path.resolve(__dirname, '..')
const ENV_PATH = path.join(APP_DIR, '.env')

// -----------------------------------------------------------
// .env parsing / serializing
// -----------------------------------------------------------

type EnvMap = Record<string, string>

function parseEnv(contents: string): EnvMap {
  const out: EnvMap = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // Strip surrounding quotes if present
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function serializeEnv(env: EnvMap, order: string[]): string {
  const written = new Set<string>()
  const lines: string[] = []
  for (const key of order) {
    if (env[key] === undefined) continue
    lines.push(`${key}="${env[key]}"`)
    written.add(key)
  }
  // Preserve any unrelated keys we didn't know about
  for (const key of Object.keys(env)) {
    if (written.has(key)) continue
    lines.push(`${key}="${env[key]}"`)
  }
  return lines.join('\n') + '\n'
}

function readExistingEnv(): EnvMap {
  if (!fs.existsSync(ENV_PATH)) return {}
  return parseEnv(fs.readFileSync(ENV_PATH, 'utf-8'))
}

// -----------------------------------------------------------
// Prompt helpers
// -----------------------------------------------------------

function defaultLogoInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.map(w => w[0]).join('').toUpperCase()
  return letters.slice(0, 3) || 'YC'
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

async function ask(
  rl: readline.Interface,
  label: string,
  opts: { default?: string; required?: boolean; validate?: (v: string) => string | null } = {}
): Promise<string> {
  const { default: def, required, validate } = opts
  const suffix = def !== undefined && def !== '' ? ` [${def}]` : ''
  while (true) {
    const raw = (await rl.question(`${label}${suffix}: `)).trim()
    const val = raw === '' ? (def ?? '') : raw
    if (required && !val) {
      process.stdout.write('  (required)\n')
      continue
    }
    if (validate) {
      const err = validate(val)
      if (err) {
        process.stdout.write(`  ${err}\n`)
        continue
      }
    }
    return val
  }
}

async function askYesNo(rl: readline.Interface, label: string, def = false): Promise<boolean> {
  const hint = def ? '[Y/n]' : '[y/N]'
  const raw = (await rl.question(`${label} ${hint}: `)).trim().toLowerCase()
  if (!raw) return def
  return raw === 'y' || raw === 'yes'
}

// Password prompt with echo suppressed. Uses the well-known readline trick:
// override _writeToOutput so characters aren't echoed (we write a '*' instead).
async function readPassword(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterfaceCb({ input: stdin, output: stdout, terminal: true })
    const ri = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream }
    let first = true
    ri._writeToOutput = (s: string) => {
      if (first) {
        // Let the prompt itself render once, then start masking.
        ri.output.write(s)
        first = false
        return
      }
      // Mask everything except newline which readline writes on submit.
      if (s.includes('\n') || s.includes('\r')) {
        ri.output.write('\n')
      } else {
        ri.output.write('*')
      }
    }
    rl.question(`${label}: `, (answer: string) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function readPasswordTwice(label: string, minLen = 8): Promise<string> {
  while (true) {
    const p1 = await readPassword(label)
    if (p1.length < minLen) {
      process.stdout.write(`  (min ${minLen} characters)\n`)
      continue
    }
    const p2 = await readPassword(`${label} (confirm)`)
    if (p1 !== p2) {
      process.stdout.write('  passwords do not match, try again\n')
      continue
    }
    return p1
  }
}

// -----------------------------------------------------------
// Child process runner
// -----------------------------------------------------------

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------

async function main() {
  process.stdout.write('\nBooks setup wizard\n')
  process.stdout.write('------------------\n\n')

  const existingEnv = readExistingEnv()

  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true })

  // ---------- Company info ----------
  process.stdout.write('Company\n')
  const companyName = await ask(rl, 'Company name', {
    default: existingEnv.COMPANY_NAME || '',
    required: true,
  })
  const legalName = await ask(rl, 'Legal name', {
    default: existingEnv.COMPANY_LEGAL_NAME || companyName,
  })
  const logoInitials = await ask(rl, 'Logo initials (max 3)', {
    default: existingEnv.COMPANY_LOGO_INITIALS || defaultLogoInitials(companyName),
    validate: (v) => (v.length > 3 ? 'max 3 characters' : null),
  })

  process.stdout.write('\nAdmin user\n')
  const adminName = await ask(rl, 'Admin name', { required: true })
  const adminEmail = await ask(rl, 'Admin email', {
    required: true,
    validate: (v) => (isEmail(v) ? null : 'not a valid email'),
  })

  // Close the shared rl before doing password prompts (those create their own).
  rl.close()

  const adminPassword = await readPasswordTwice('Admin password (min 8 chars)')

  const rl2 = readline.createInterface({ input: stdin, output: stdout, terminal: true })

  // ---------- Defaults ----------
  process.stdout.write('\nDefaults\n')
  const defaultCurrency = await ask(rl2, 'Default currency (USD, CAD, EUR, GBP)', {
    default: 'USD',
  })
  const defaultPaymentTerms = await ask(rl2, 'Default payment terms', {
    default: 'net30',
  })

  // ---------- Stripe ----------
  process.stdout.write('\nOnline payments (Stripe)\n')
  const stripeEnv: EnvMap = {}
  const wantStripe = await askYesNo(rl2, 'Configure online payments (Stripe) now?', false)
  if (wantStripe) {
    stripeEnv.STRIPE_SECRET_KEY = await ask(rl2, 'STRIPE_SECRET_KEY (sk_...)', {
      default: existingEnv.STRIPE_SECRET_KEY || '',
    })
    stripeEnv.STRIPE_WEBHOOK_SECRET = await ask(rl2, 'STRIPE_WEBHOOK_SECRET (whsec_...)', {
      default: existingEnv.STRIPE_WEBHOOK_SECRET || '',
    })
    stripeEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = await ask(
      rl2,
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_...)',
      { default: existingEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '' },
    )
  } else {
    process.stdout.write(
      '  You can add Stripe later by editing app/.env or re-running npx tsx scripts/setup.ts\n',
    )
  }

  // ---------- Mailgun ----------
  process.stdout.write('\nEmail (Mailgun)\n')
  const mailEnv: EnvMap = {}
  const wantMail = await askYesNo(rl2, 'Configure email (Mailgun) now?', false)
  if (wantMail) {
    mailEnv.MAILGUN_API_KEY = await ask(rl2, 'MAILGUN_API_KEY', {
      default: existingEnv.MAILGUN_API_KEY || '',
    })
    mailEnv.MAILGUN_DOMAIN = await ask(rl2, 'MAILGUN_DOMAIN', {
      default: existingEnv.MAILGUN_DOMAIN || '',
    })
    mailEnv.MAILGUN_REGION = await ask(rl2, 'MAILGUN_REGION', {
      default: existingEnv.MAILGUN_REGION || 'us',
    })
    mailEnv.EMAIL_FROM = await ask(rl2, 'EMAIL_FROM', {
      default: existingEnv.EMAIL_FROM || `postmaster@${mailEnv.MAILGUN_DOMAIN || 'example.com'}`,
    })
  } else {
    process.stdout.write(
      '  You can add Mailgun later by editing app/.env or re-running npx tsx scripts/setup.ts\n',
    )
  }

  rl2.close()

  // ---------- Write .env ----------
  const merged: EnvMap = { ...existingEnv }
  merged.DATABASE_URL = existingEnv.DATABASE_URL || 'postgresql://books:books@localhost:5432/books'
  merged.REDIS_URL = existingEnv.REDIS_URL || 'redis://localhost:6379'
  merged.NEXTAUTH_URL = existingEnv.NEXTAUTH_URL || 'http://localhost:3000'
  // Don't regenerate NEXTAUTH_SECRET if one is already set.
  if (!merged.NEXTAUTH_SECRET || merged.NEXTAUTH_SECRET === 'generate-a-random-secret-here') {
    merged.NEXTAUTH_SECRET = crypto.randomBytes(32).toString('base64')
  }
  if (wantStripe) Object.assign(merged, stripeEnv)
  if (wantMail) Object.assign(merged, mailEnv)

  const order = [
    'DATABASE_URL',
    'REDIS_URL',
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'MAILGUN_API_KEY',
    'MAILGUN_DOMAIN',
    'MAILGUN_REGION',
    'EMAIL_FROM',
  ]
  fs.writeFileSync(ENV_PATH, serializeEnv(merged, order), { mode: 0o600 })
  fs.chmodSync(ENV_PATH, 0o600)
  process.stdout.write('\nWrote app/.env (0600)\n')

  // Reload env for the Prisma steps below (the initial dotenv/config ran before the file existed).
  process.env.DATABASE_URL = merged.DATABASE_URL
  process.env.REDIS_URL = merged.REDIS_URL
  process.env.NEXTAUTH_URL = merged.NEXTAUTH_URL
  process.env.NEXTAUTH_SECRET = merged.NEXTAUTH_SECRET

  // ---------- Prisma ----------
  process.stdout.write('\nRunning prisma generate...\n')
  await run('npx', ['prisma', 'generate'], APP_DIR)
  process.stdout.write('\nRunning prisma db push...\n')
  await run('npx', ['prisma', 'db', 'push', '--accept-data-loss'], APP_DIR)

  // ---------- Seed company + admin ----------
  process.stdout.write('\nSeeding company settings and admin user...\n')
  // Import lazily so the generated client is available (prisma generate above).
  const { PrismaClient } = await import('../src/generated/prisma/client')
  const prisma = new PrismaClient()
  try {
    const companyValues = {
      name: companyName,
      legalName: legalName || companyName,
      logoInitials,
      defaultCurrency,
      defaultPaymentTerms,
    }
    await prisma.companySettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...companyValues },
      update: companyValues,
    })

    const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } })
    const hashed = await bcrypt.hash(adminPassword, 12)
    if (existingUser) {
      const rl3 = readline.createInterface({ input: stdin, output: stdout, terminal: true })
      const updatePw = await askYesNo(
        rl3,
        `Admin ${adminEmail} already exists. Update password and name?`,
        true,
      )
      rl3.close()
      if (updatePw) {
        await prisma.user.update({
          where: { email: adminEmail },
          data: { name: adminName, hashedPassword: hashed },
        })
        process.stdout.write('  admin updated\n')
      } else {
        process.stdout.write('  admin left as-is\n')
      }
    } else {
      await prisma.user.create({
        data: { name: adminName, email: adminEmail, hashedPassword: hashed },
      })
      process.stdout.write('  admin created\n')
    }
  } finally {
    await prisma.$disconnect()
  }

  // ---------- Done ----------
  process.stdout.write('\n')
  process.stdout.write('============================================\n')
  process.stdout.write(' Setup complete.\n')
  process.stdout.write('\n')
  process.stdout.write(` Company:    ${companyName}\n`)
  process.stdout.write(` Admin:      ${adminEmail}\n`)
  process.stdout.write(` App URL:    http://localhost:3000\n`)
  process.stdout.write('\n')
  process.stdout.write(' Next: cd app && npm run dev\n')
  process.stdout.write('============================================\n')
}

main().catch((err) => {
  process.stderr.write(`\nSetup failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
