import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'

// Simple in-memory rate limit for this public endpoint
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const MAX_REQUESTS = 5
const WINDOW_MS = 60 * 1000 // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_REQUESTS) return false
  entry.count++
  return true
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'
    if (!checkRateLimit(ip)) {
      return Response.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { token, status, signerName, signerEmail } = body as {
      token?: string
      status?: string
      signerName?: string
      signerEmail?: string
    }

    // Validate input
    if (!token || typeof token !== 'string' || token.length !== 32) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }
    if (!['accepted', 'declined'].includes(status || '')) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Accept requires signer details
    if (status === 'accepted') {
      if (
        !signerName ||
        typeof signerName !== 'string' ||
        signerName.trim().length < 2 ||
        signerName.length > 200
      ) {
        return Response.json(
          { error: 'Please enter your full name to accept this estimate.' },
          { status: 400 }
        )
      }
      if (
        !signerEmail ||
        typeof signerEmail !== 'string' ||
        !EMAIL_RE.test(signerEmail) ||
        signerEmail.length > 200
      ) {
        return Response.json(
          { error: 'Please enter a valid email to accept this estimate.' },
          { status: 400 }
        )
      }
    }

    const estimate = await prisma.estimate.findUnique({
      where: { shareToken: token },
    })

    if (!estimate) {
      // Don't reveal whether token exists or not — always return same error
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Only allow response from sent/viewed/draft states — not already accepted/declined/invoiced
    const allowedStates = ['sent', 'viewed', 'draft']
    if (!allowedStates.includes(estimate.status)) {
      return Response.json(
        { error: 'This estimate cannot be responded to.' },
        { status: 400 }
      )
    }

    const userAgent = request.headers.get('user-agent') || ''

    // Save response audit record + update status atomically
    await prisma.$transaction([
      prisma.estimate.update({
        where: { id: estimate.id },
        data: { status: status as string },
      }),
      prisma.estimateResponse.upsert({
        where: { estimateId: estimate.id },
        update: {
          status: status as string,
          signerName: (signerName || '').trim().slice(0, 200),
          signerEmail: (signerEmail || '').trim().toLowerCase().slice(0, 200),
          ipAddress: ip.slice(0, 64),
          userAgent: userAgent.slice(0, 500),
        },
        create: {
          estimateId: estimate.id,
          status: status as string,
          signerName: (signerName || '').trim().slice(0, 200),
          signerEmail: (signerEmail || '').trim().toLowerCase().slice(0, 200),
          ipAddress: ip.slice(0, 64),
          userAgent: userAgent.slice(0, 500),
        },
      }),
    ])

    return Response.json({ success: true, status })
  } catch (error) {
    console.error('Estimate respond error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
