import { NextRequest } from 'next/server'
import { readAuth } from '@/lib/forecasts/api'
import { ensureDefaultScenarios } from '@/lib/forecasts/server'

// List forecast scenarios (bootstraps Personal + Business on first call).
export async function GET(request: NextRequest) {
  const denied = await readAuth(request)
  if (denied) return denied
  const data = await ensureDefaultScenarios()
  return Response.json({ data })
}
