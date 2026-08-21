import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { companySettingsSchema } from '@/lib/validators'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const parsed = companySettingsSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    // Strip undefined fields so we don't overwrite values with undefined.
    // Numbers are carried through too (the fiscal year-end) — a string-only
    // copy would silently drop them.
    const data: Record<string, string | number> = {}
    for (const [key, value] of Object.entries(parsed.data)) {
      if (typeof value === 'string' || typeof value === 'number') data[key] = value
    }
    // Normalise the program account to upper-case (the program-letter pair is
    // case-insensitive on input but stored canonical).
    if (typeof data.t2ProgramAccount === 'string') data.t2ProgramAccount = data.t2ProgramAccount.toUpperCase()

    const row = await prisma.companySettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
    })

    return Response.json(row)
  } catch (e) {
    console.error('Update company settings error:', e)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
