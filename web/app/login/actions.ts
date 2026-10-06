'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { koppelLogin } from '@/lib/monteur';

export interface LoginStaat {
  stap: 'email' | 'code';
  email?: string;
  fout?: string;
}

export async function stuurLink(_: LoginStaat, form: FormData): Promise<LoginStaat> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { stap: 'email', fout: 'Vul een geldig e-mailadres in.' };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Alleen op uitnodiging: onbekende adressen krijgen geen account.
      shouldCreateUser: false,
      emailRedirectTo: `${process.env.SITE_URL}/auth/confirm`,
    },
  });

  if (error) {
    // Zelfde antwoord voor onbekende adressen, zodat niemand kan uitproberen
    // wie er klant is. Alleen een echte storing melden.
    if (error.status === 429) return { stap: 'email', email, fout: 'Te veel pogingen. Probeer het over een paar minuten opnieuw.' };
    if (!/signups not allowed|not found|otp_disabled/i.test(error.message)) {
      console.error('signInWithOtp:', error.message);
    }
  }
  return { stap: 'code', email };
}

export async function controleerCode(_: LoginStaat, form: FormData): Promise<LoginStaat> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  if (!/^\d{6,8}$/.test(code)) return { stap: 'code', email, fout: 'De code bestaat uit cijfers.' };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error || !data.user) return { stap: 'code', email, fout: 'Deze code klopt niet of is verlopen. Vraag een nieuwe aan.' };

  if (!(await koppelLogin(data.user.id, email))) {
    await supabase.auth.signOut();
    return { stap: 'email', fout: 'Dit e-mailadres hoort niet bij een monteur. Vraag een uitnodiging aan.' };
  }
  redirect('/');
}

export async function uitloggen() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}
