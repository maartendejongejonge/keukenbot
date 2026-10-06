'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

/** Seintje afhandelen of negeren. RLS zorgt dat het alleen je eigen seintjes kunnen zijn. */
export async function zetSeintje(form: FormData) {
  const id = String(form.get('id') ?? '');
  const status = form.get('status') === 'genegeerd' ? 'genegeerd' : 'afgehandeld';
  if (!id) return;
  const supabase = await supabaseServer();
  await supabase
    .from('review_items')
    .update({ status, afgehandeld_op: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'open');
  revalidatePath('/', 'layout');
}
