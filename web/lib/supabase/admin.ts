import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase met de service role: omzeilt RLS. Alleen voor wat de monteur zelf
 * niet mag: Google-tokens opslaan, zijn login aan zijn monteur koppelen,
 * uitnodigen en het WhatsApp-kanaal instellen (beheer).
 * Nooit vanuit een Client Component importeren.
 */
export function supabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
