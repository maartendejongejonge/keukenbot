import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import type { Monteur, Profiel } from './types';

export function isBeheerder(email: string | null | undefined): boolean {
  if (!email) return false;
  const lijst = (process.env.BEHEERDERS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return lijst.includes(email.toLowerCase());
}

/**
 * Koppelt een login de eerste keer aan zijn monteur, op e-mailadres.
 * De rij in `monteurs` is aangemaakt bij de uitnodiging (of bestond al, zoals
 * Rotterdam Keukenmontage). Zonder rij: geen toegang.
 */
export async function koppelLogin(userId: string, email: string): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data: al } = await admin.from('monteurs').select('id').eq('auth_user_id', userId).maybeSingle();
  if (al) return true;

  const { data: rij } = await admin
    .from('monteurs')
    .select('id, auth_user_id')
    .ilike('email', email)
    .maybeSingle();
  if (!rij || rij.auth_user_id) return false;

  const { error } = await admin.from('monteurs').update({ auth_user_id: userId }).eq('id', rij.id);
  return !error;
}

export interface Sessie {
  email: string;
  beheerder: boolean;
  monteur: Monteur;
  profiel: Profiel;
}

/** De ingelogde monteur met zijn profiel; stuurt anders naar /login. */
export const huidigeSessie = cache(async (): Promise<Sessie> => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect('/login');

  let { data: monteur } = await supabase.from('monteurs').select('*').maybeSingle();
  if (!monteur) {
    // Eerste keer inloggen via een link die niet langs /auth/confirm kwam.
    if (await koppelLogin(user.id, user.email)) {
      ({ data: monteur } = await supabase.from('monteurs').select('*').maybeSingle());
    }
  }
  if (!monteur) redirect('/login?fout=geen-account');

  const { data: profiel } = await supabase.from('monteur_profielen').select(PROFIEL_KOLOMMEN).single();
  if (!profiel) redirect('/login?fout=geen-profiel');

  return {
    email: user.email,
    beheerder: isBeheerder(user.email),
    monteur: monteur as Monteur,
    profiel: profiel as unknown as Profiel,
  };
});

/** Alle profielkolommen die de browser mag lezen (zie migratie 0006). */
export const PROFIEL_KOLOMMEN = [
  'monteur_id', 'werkgebied_pc4', 'max_reistijd_min', 'werkdagen', 'werkdag_start', 'werkdag_eind',
  'buffer_dagdelen', 'inmeting_duur_min', 'montage_duur_dagdelen', 'profiel_ingevuld', 'toon', 'weigert',
  'google_agenda_id', 'whatsapp_nummer', 'hersteldag_na_meerdaagse', 'vertrek_postcode', 'km_tarief',
  'uurtarief', 'reisuur_percentage', 'gratis_pc4', 'hotel_richtprijs', 'prijzen_tonen', 'uurnormen',
  'aanspreeknaam', 'advies', 'klusjes', 'transport', 'google_gekoppeld_op', 'google_email', 'telefoon_voor_klanten',
].join(', ');
