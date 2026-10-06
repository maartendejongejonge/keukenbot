import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { huidigeSessie } from '@/lib/monteur';
import { STATE_COOKIE, googleAutorisatieUrl } from '@/lib/google';

/** Stuurt de monteur naar Google om zijn agenda te koppelen. */
export async function GET() {
  const { email } = await huidigeSessie();
  // Willekeurige waarde die terug moet komen: zo hoort het antwoord van
  // Google bij dit verzoek, in deze browser.
  const state = randomBytes(24).toString('base64url');
  const res = NextResponse.redirect(googleAutorisatieUrl(state, email));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/api/google', maxAge: 600,
  });
  return res;
}
