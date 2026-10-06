import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase met de sessie van de ingelogde monteur. Alles wat hiermee gaat,
 * valt onder RLS: hij ziet alleen zijn eigen rijen en kan alleen de kolommen
 * wijzigen die migratie 0006 vrijgeeft.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (lijst) => {
          try {
            for (const { name, value, options } of lijst) store.set(name, value, options);
          } catch {
            // Aangeroepen vanuit een Server Component: daar mag je geen cookies
            // zetten. De middleware ververst de sessie al, dus dit is veilig.
          }
        },
      },
    },
  );
}
