// Setup endpoint is disabled. Admin account is created programmatically via seed script.
// This prevents any unauthorized user creation.

export async function POST() {
  return Response.json(
    { error: 'Setup is disabled. Admin accounts are managed by the system administrator.' },
    { status: 403 }
  )
}

export async function GET() {
  return Response.json(
    { error: 'Setup is disabled.' },
    { status: 403 }
  )
}
