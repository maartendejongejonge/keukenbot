'use server';

import { revalidatePath } from 'next/cache';
import { huidigeSessie } from '@/lib/monteur';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normaliseerNummer } from '@/lib/format';

export interface BeheerStaat {
  ok?: boolean;
  bericht?: string;
  link?: string;
  naam?: string;
}

async function alleenBeheerder() {
  const s = await huidigeSessie();
  if (!s.beheerder) throw new Error('Geen toegang');
  return s;
}

const tekst = (f: FormData, n: string) => String(f.get(n) ?? '').trim();

/** Inloglink die werkt op elk apparaat (zie /auth/confirm). */
async function maakLink(email: string, soort: 'invite' | 'magiclink'): Promise<string> {
  const admin = supabaseAdmin();
  let { data, error } = await admin.auth.admin.generateLink({ type: soort, email });
  // Bestaat het account al, dan is een uitnodiging niet meer nodig.
  if (error && soort === 'invite') ({ data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email }));
  if (error || !data?.properties?.hashed_token) throw new Error(error?.message ?? 'Geen link gekregen');
  const type = data.properties.verification_type ?? soort;
  return `${process.env.SITE_URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=${type}`;
}

export async function nodigUit(_: BeheerStaat, f: FormData): Promise<BeheerStaat> {
  await alleenBeheerder();
  const bedrijfsnaam = tekst(f, 'bedrijfsnaam');
  const contactnaam = tekst(f, 'contactnaam');
  const email = tekst(f, 'email').toLowerCase();
  const abonnement = ['basis', 'plus', 'ploeg'].includes(tekst(f, 'abonnement')) ? tekst(f, 'abonnement') : 'basis';
  const telRuw = tekst(f, 'telefoon');
  const telefoon = telRuw ? normaliseerNummer(telRuw) : null;

  if (!bedrijfsnaam || !contactnaam) return { bericht: 'Vul bedrijfsnaam en naam in.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { bericht: 'Vul een geldig e-mailadres in.' };
  if (telRuw && !telefoon) return { bericht: 'Het mobiele nummer klopt niet. Bijvoorbeeld 06-12345678.' };

  const admin = supabaseAdmin();
  const { data: bestaand } = await admin.from('monteurs').select('id').ilike('email', email).maybeSingle();
  if (bestaand) return { bericht: 'Dit e-mailadres heeft al een account. Maak hieronder een nieuwe inloglink.' };

  const { data: m, error } = await admin.from('monteurs').insert({
    bedrijfsnaam, contactnaam, email, telefoon, abonnement, actief: true, uitgenodigd_op: new Date().toISOString(),
  }).select('id').single();
  if (error || !m) return { bericht: `Aanmaken mislukt: ${error?.message}` };

  const p = await admin.from('monteur_profielen').insert({ monteur_id: m.id, aanspreeknaam: contactnaam.split(' ')[0] });
  if (p.error) {
    await admin.from('monteurs').delete().eq('id', m.id);
    return { bericht: `Profiel aanmaken mislukt: ${p.error.message}` };
  }

  try {
    const link = await maakLink(email, 'invite');
    revalidatePath('/beheer');
    return { ok: true, link, naam: contactnaam, bericht: `${bedrijfsnaam} is aangemaakt.` };
  } catch (e) {
    revalidatePath('/beheer');
    return { bericht: `Account aangemaakt, maar de inloglink lukte niet: ${String(e)}` };
  }
}

export async function nieuweLink(_: BeheerStaat, f: FormData): Promise<BeheerStaat> {
  await alleenBeheerder();
  const id = tekst(f, 'id');
  const admin = supabaseAdmin();
  const { data: m } = await admin.from('monteurs').select('email, contactnaam, auth_user_id').eq('id', id).single();
  if (!m) return { bericht: 'Monteur niet gevonden.' };
  try {
    const link = await maakLink(m.email, m.auth_user_id ? 'magiclink' : 'invite');
    return { ok: true, link, naam: m.contactnaam };
  } catch (e) {
    return { bericht: `Link maken mislukt: ${String(e)}` };
  }
}

/**
 * Het WhatsApp-nummer van de bot voor deze monteur. De runner herkent aan
 * dit kanaal bij welke monteur een binnenkomend bericht hoort.
 */
export async function zetWhatsApp(_: BeheerStaat, f: FormData): Promise<BeheerStaat> {
  await alleenBeheerder();
  const id = tekst(f, 'id');
  const ruw = tekst(f, 'whatsapp');
  const admin = supabaseAdmin();

  if (!ruw) {
    await admin.from('kanalen').update({ actief: false }).eq('monteur_id', id).eq('soort', 'whatsapp');
    await admin.from('monteur_profielen').update({ whatsapp_nummer: null }).eq('monteur_id', id);
    revalidatePath('/beheer');
    return { ok: true, bericht: 'WhatsApp ontkoppeld.' };
  }

  const nr = normaliseerNummer(ruw);
  if (!nr) return { bericht: 'Gebruik een mobiel nummer, bijvoorbeeld 06-12345678.' };

  const { data: ander } = await admin.from('kanalen').select('monteur_id')
    .eq('soort', 'whatsapp').eq('externe_id', nr).eq('actief', true).neq('monteur_id', id).maybeSingle();
  if (ander) return { bericht: 'Dit nummer hoort al bij een andere monteur.' };

  await admin.from('kanalen').update({ actief: false }).eq('monteur_id', id).eq('soort', 'whatsapp').neq('externe_id', nr);
  const { data: al } = await admin.from('kanalen').select('id').eq('monteur_id', id).eq('soort', 'whatsapp').eq('externe_id', nr).maybeSingle();
  if (al) await admin.from('kanalen').update({ actief: true }).eq('id', al.id);
  else await admin.from('kanalen').insert({ monteur_id: id, soort: 'whatsapp', externe_id: nr, actief: true });
  await admin.from('monteur_profielen').update({ whatsapp_nummer: nr }).eq('monteur_id', id);

  revalidatePath('/beheer');
  return { ok: true, bericht: 'WhatsApp-nummer opgeslagen.' };
}

export async function zetActief(f: FormData) {
  await alleenBeheerder();
  const admin = supabaseAdmin();
  await admin.from('monteurs').update({ actief: f.get('actief') === 'true' }).eq('id', tekst(f, 'id'));
  revalidatePath('/beheer');
}

export async function zetAbonnement(f: FormData) {
  await alleenBeheerder();
  const ab = tekst(f, 'abonnement');
  if (!['basis', 'plus', 'ploeg'].includes(ab)) return;
  const admin = supabaseAdmin();
  await admin.from('monteurs').update({ abonnement: ab }).eq('id', tekst(f, 'id'));
  revalidatePath('/beheer');
}
