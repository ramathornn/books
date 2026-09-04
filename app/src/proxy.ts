import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

const PUBLIC_PATHS = [
  '/login',
  '/favicon.ico',
  // Audit snapshot does its own bearer-key auth in the route handler, so it
  // must bypass the session-cookie redirect (external agents have no session).
  '/api/audit-snapshot',
  // Plaid webhook (verified via ES256 JWT) and the daily sync cron (shared
  // secret) have no user session — they authenticate inside the route.
  '/api/plaid/webhook',
  '/api/plaid/sync-all',
  // Headless upload/import endpoints — they do their own Bearer-token OR session
  // auth (requireApiAuth) in the route handler, so they must bypass the
  // session-cookie redirect for sandbox/agent curl callers.
  '/api/files/upload',
  '/api/files/upload-bulk',
  '/api/banking/import-csv',
  '/api/banking/exclude',
  '/api/banking/transfer',
  '/api/banking/categorize',
  '/api/banking/uncategorize',
  '/api/banking/match',
  '/api/banking/match-split',
  '/api/banking/pending-transactions',
  // List reads + headless create for matching/booking (the routes do their own
  // requireApiAuth). POST creates invoices/payments and books dividends.
  '/api/invoices',
  '/api/payments',
  '/api/tax/t5/declare-dividend',
  // Journal entries — list/create; the per-id routes are matched by
  // isPublicJournalEntryRequest below. All do their own requireApiAuth.
  '/api/journal-entries',
  // Chart-of-accounts list (GET does requireApiAuth; POST stays session-only
  // in the handler, so bearer callers get 401 on create).
  '/api/gl-accounts',
  // Invite acceptance — anonymous by design; the single-use token in the body
  // is the credential. The route validates token + expiry.
  '/api/users/accept-invite',
  // Stripe online payments — anonymous payers on /invoice/{token} start the
  // charge here; the route validates the shareToken + onlinePaymentsEnabled.
  '/api/stripe/create-payment-intent',
  // Stripe webhook — authenticated by signature verification (STRIPE_WEBHOOK_SECRET)
  // inside the route; Stripe's servers carry no session cookie.
  '/api/stripe/webhook',
]

const PUBLIC_PATH_PREFIXES = [
  '/api/auth/',
  '/api/estimates/respond',
  '/_next/',
]

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Pages (and their API twins) an accountant may not view at all. Note the
// public share pages /estimate/{token} and /api/estimates/respond are
// anonymous (no session cookie) so they never reach this check.
function isAccountantHiddenPath(pathname: string): boolean {
  return (
    pathname === '/settings' || pathname.startsWith('/settings/') ||
    pathname === '/team-members' || pathname.startsWith('/team-members/') ||
    pathname === '/estimates' || pathname.startsWith('/estimates/') ||
    pathname.startsWith('/api/team-members') ||
    pathname.startsWith('/api/estimates') ||
    pathname.startsWith('/api/users')
  )
}

// Read-only + visibility enforcement for the 'accountant' role, applied
// centrally so every route is covered without per-route checks. Runs BEFORE
// the public-path allowances: several /api paths bypass the session redirect
// for bearer-token agents but their handlers also accept sessions
// (requireApiAuth), so an accountant session must be rejected here, not in
// the handler. /api/auth/* is exempt (sign-out + self-service password/2FA/
// passkeys). Bearer-token callers carry no session cookie → unaffected.
// Returns 'mutation' | 'hidden' | null.
async function accountantViolation(
  request: NextRequest,
  pathname: string
): Promise<'mutation' | 'hidden' | null> {
  if (pathname.startsWith('/api/auth/')) return null

  const isMutation = pathname.startsWith('/api/') && MUTATING_METHODS.has(request.method)
  const isHidden = isAccountantHiddenPath(pathname)
  if (!isMutation && !isHidden) return null

  const hasSecureCookie = !!request.cookies.get('__Secure-authjs.session-token')
  const hasDevCookie = !!request.cookies.get('authjs.session-token')
  if (!hasSecureCookie && !hasDevCookie) return null

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie: hasSecureCookie,
  })
  // No role claim (pre-role token) ⇒ 'owner' — same default as the session
  // callback in lib/auth.ts.
  if (token?.role !== 'accountant') return null
  return isHidden ? 'hidden' : 'mutation'
}

// Public share pages — match /invoice/{token} and /estimate/{token} only
// Must NOT match /invoices or /estimates (dashboard pages)
function isPublicSharePage(pathname: string): boolean {
  // /invoice/{token} — exactly two segments, token is 32-char hex
  const invoiceMatch = pathname.match(/^\/invoice\/([a-f0-9]{32})$/)
  if (invoiceMatch) return true
  // /estimate/{token} — exactly two segments, token is 32-char hex
  const estimateMatch = pathname.match(/^\/estimate\/([a-f0-9]{32})$/)
  if (estimateMatch) return true
  // /invite/{token} — user-invite acceptance page, token is 64-char hex
  if (/^\/invite\/[a-f0-9]{64}$/.test(pathname)) return true
  return false
}

// Post-payment status poll — /api/public-invoice/{token}/status. Anonymous by
// design (the share token is the credential, same as /invoice/{token}); the
// route 404s on unknown tokens and only returns payment totals.
function isPublicInvoiceStatusPoll(pathname: string): boolean {
  return /^\/api\/public-invoice\/[a-f0-9]{32}\/status$/.test(pathname)
}

// Per-account ledger read — /api/accounts/{id}/ledger. Does its own bearer-token
// OR session auth (requireApiAuth) in the route, so it must bypass the
// session-cookie redirect for headless callers.
function isPublicLedgerRequest(pathname: string): boolean {
  return /^\/api\/accounts\/[^/]+\/ledger$/.test(pathname)
}

// Invoice status flip — /api/invoices/{id}/status (PATCH). Does its own
// requireApiAuth; allowlisted so headless callers can mark an invoice sent
// (which auto-accrues it for matching).
function isPublicInvoiceStatusRequest(pathname: string): boolean {
  return /^\/api\/invoices\/[^/]+\/status$/.test(pathname)
}

// Invoice read/edit — /api/invoices/{id} (GET/PUT only). The route does its
// own bearer-or-session auth (requireApiAuth) so headless agents can fetch and
// replace line items. DELETE is deliberately NOT bypassed: it stays behind the
// session-cookie redirect and the handler is session-only.
function isPublicInvoiceEditRequest(pathname: string, method: string): boolean {
  if (method !== 'GET' && method !== 'PUT') return false
  return /^\/api\/invoices\/[^/]+$/.test(pathname)
}

// Forecasts API — GET/POST/PUT/PATCH bypass the session redirect so headless
// agents can read and edit scenarios (handlers use requireApiAuth / writeAuth).
// DELETE stays behind the session cookie, and the handlers additionally reject
// accountants.
function isPublicForecastRead(pathname: string, method: string): boolean {
  if (!pathname.startsWith('/api/forecasts')) return false
  return method === 'GET' || method === 'POST' || method === 'PUT' || method === 'PATCH'
}

// Journal-entry per-id routes — /api/journal-entries/{id} (GET/PUT/DELETE) and
// /api/journal-entries/{id}/reverse (POST). All do their own bearer-or-session
// auth (requireApiAuth) in the route handler.
function isPublicJournalEntryRequest(pathname: string): boolean {
  return /^\/api\/journal-entries\/[^/]+(\/reverse)?$/.test(pathname)
}

// PDF download endpoints — public when a valid-looking ?token=... is present.
// The route handler itself validates the token against the invoice/estimate.
function isPublicPdfRequest(pathname: string, token: string | null): boolean {
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return false
  if (/^\/api\/invoices\/[^/]+\/pdf$/.test(pathname)) return true
  if (/^\/api\/estimates\/[^/]+\/pdf$/.test(pathname)) return true
  return false
}

// In-memory rate limiting fallback (when Redis is not available in proxy context)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false
  }

  entry.count++
  return true
}

// Clean up stale entries periodically
function cleanupRateLimitMap() {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key)
    }
  }
}

// Run cleanup every 5 minutes
let lastCleanup = Date.now()

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Periodic cleanup
  if (Date.now() - lastCleanup > 5 * 60 * 1000) {
    cleanupRateLimitMap()
    lastCleanup = Date.now()
  }

  // Rate limit /login POST requests
  if ((pathname === '/login' || pathname.startsWith('/api/auth/')) && request.method === 'POST') {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') ||
               'unknown'

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }
  }

  // Accountant sessions: read-only everywhere, and Settings / Team Members /
  // Estimates are hidden outright. Enforced before any public-path allowance
  // can let the request through to a session-accepting handler.
  const violation = await accountantViolation(request, pathname)
  if (violation === 'mutation') {
    return addSecurityHeaders(
      NextResponse.json(
        { error: 'Read-only access: accountant accounts cannot make changes.', code: 'READ_ONLY_ROLE' },
        { status: 403 }
      )
    )
  }
  if (violation === 'hidden') {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(
        NextResponse.json(
          { error: 'Not available to accountant accounts.', code: 'ROLE_HIDDEN' },
          { status: 403 }
        )
      )
    }
    return addSecurityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)))
  }

  // Allow public paths
  if (PUBLIC_PATHS.includes(pathname)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Allow public path prefixes
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return addSecurityHeaders(NextResponse.next())
    }
  }

  // Allow public share pages (strict token format validation)
  if (isPublicSharePage(pathname)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Allow the post-payment status poll from the public pay widget
  if (isPublicInvoiceStatusPoll(pathname)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Allow the per-account ledger read (route does its own bearer/session auth)
  if (isPublicLedgerRequest(pathname)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Allow the invoice status flip (route does its own bearer/session auth)
  if (isPublicInvoiceStatusRequest(pathname)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Allow invoice read/edit (GET/PUT only; route does its own bearer/session auth)
  if (isPublicInvoiceEditRequest(pathname, request.method)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Allow forecast reads (route does its own bearer/session auth)
  if (isPublicForecastRead(pathname, request.method)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Allow journal-entry mutations (routes do their own bearer/session auth)
  if (isPublicJournalEntryRequest(pathname)) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Allow PDF downloads from share links (token validated by the route)
  if (
    isPublicPdfRequest(pathname, request.nextUrl.searchParams.get('token'))
  ) {
    return addSecurityHeaders(NextResponse.next())
  }

  // Check for NextAuth session token cookie (JWT strategy)
  // NextAuth v5 uses "authjs.session-token" in dev and "__Secure-authjs.session-token" in production
  const sessionToken =
    request.cookies.get('authjs.session-token')?.value ||
    request.cookies.get('__Secure-authjs.session-token')?.value

  if (!sessionToken) {
    // Not authenticated — redirect to login
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return addSecurityHeaders(NextResponse.redirect(loginUrl))
  }

  // Authenticated — allow through
  const response = NextResponse.next()
  return addSecurityHeaders(response)
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Force HTTPS for a year so a MITM can't downgrade to HTTP after first visit.
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains'
  )
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}
