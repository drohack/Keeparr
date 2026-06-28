import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Lightweight liveness probe used by the Docker healthcheck.
export async function GET() {
  return NextResponse.json({ ok: true });
}
