import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { koppelLogin } from '@/lib/monteur';

/**
 * Hier komt de link uit de mail (of uit een inloglink van de beheerder) aan.
 *
 * Twee vormen:
 *   ?token_hash=…&type=email|magiclink|invite  (werkt op elk apparaat; zie README voor de mailsjablonen)
 *   ?code=…                                    (standaard PKCE, alleen in dezelfde browser)
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  const naar = (pad: string) => NextResponse.redirect(new URL(pad, process.env.SITE_URL ?? url.origin));

  const supabase = await supabaseServer();
  let fout = true;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    fout = Boolean(error);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    fout = Boolean(error);
  }

  if (fout) return naar('/login?fout=link-verlopen');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !(await koppelLogin(user.id, user.email))) {
    await supabase.auth.signOut();
    return naar('/login?fout=geen-account');
  }
  return naar('/');
}
