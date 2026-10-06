import { NextResponse, type NextRequest } from 'next/server';
import { huidigeSessie } from '@/lib/monteur';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { STATE_COOKIE, hoofdagenda, wisselCode } from '@/lib/google';

/**
 * Google stuurt de monteur hier terug met een code. Die ruilen we voor een
 * refresh token, dat alleen de server en de runner kunnen lezen
 * (tabel google_koppelingen, zonder policies).
 */
export async function GET(req: NextRequest) {
  const terug = (uitslag: string) => {
    const res = NextResponse.redirect(new URL(`/koppelingen?google=${uitslag}`, process.env.SITE_URL ?? req.nextUrl.origin));
    res.cookies.delete({ name: STATE_COOKIE, path: '/api/google' });
    return res;
  };

  const { monteur } = await huidigeSessie();
  const p = req.nextUrl.searchParams;

  if (p.get('error')) return terug(p.get('error') === 'access_denied' ? 'geweigerd' : 'mislukt');
  const verwacht = req.cookies.get(STATE_COOKIE)?.value;
  if (!verwacht || verwacht !== p.get('state') || !p.get('code')) return terug('mislukt');

  try {
    const tokens = await wisselCode(p.get('code')!);
    if (!tokens.refresh_token) return terug('geen-token');

    const agenda = await hoofdagenda(tokens.access_token);
    const admin = supabaseAdmin();
    const nu = new Date().toISOString();

    const k = await admin.from('google_koppelingen').upsert({
      monteur_id: monteur.id,
      refresh_token: tokens.refresh_token,
      agenda_id: 'primary',
      email: agenda,
      bijgewerkt_op: nu,
    });
    if (k.error) throw new Error(k.error.message);

    await admin.from('monteur_profielen').update({
      google_gekoppeld_op: nu,
      google_email: agenda,
      google_agenda_id: 'primary',
    }).eq('monteur_id', monteur.id);

    return terug('ok');
  } catch (e) {
    console.error('google koppelen:', String(e));
    return terug('mislukt');
  }
}
