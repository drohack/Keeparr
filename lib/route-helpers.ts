import { NextResponse } from 'next/server';
import { AuthError } from './auth';

/** Convert thrown AuthError (or anything) into a JSON error response. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json(
    { error: 'internal_error', message: String(e) },
    { status: 500 }
  );
}
