// Legacy alias — Merchants were renamed to Vendors. Forwards to /api/vendors.
import { NextRequest } from 'next/server'
import { GET as vendorsGet, POST as vendorsPost } from '../vendors/route'

export async function GET(request: NextRequest) {
  return vendorsGet(request)
}

export async function POST(request: NextRequest) {
  return vendorsPost(request)
}
