'use server';

import { revalidatePath } from 'next/cache';
import { huidigeSessie } from '@/lib/monteur';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { trekIn } from '@/lib/google';

/** Agenda ontkoppelen: token bij Google intrekken en hier weggooien. */
export async function ontkoppelGoogle() {
  const { monteur } = await huidigeSessie();
  const admin = supabaseAdmin();
  const { data } = await admin.from('google_koppelingen').select('refresh_token').eq('monteur_id', monteur.id).maybeSingle();
  if (data?.refresh_token) await trekIn(data.refresh_token);
  await admin.from('google_koppelingen').delete().eq('monteur_id', monteur.id);
  await admin.from('monteur_profielen')
    .update({ google_gekoppeld_op: null, google_email: null })
    .eq('monteur_id', monteur.id);
  revalidatePath('/', 'layout');
}
