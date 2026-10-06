import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Paden die zonder login bereikbaar zijn. */
const OPEN = ['/login', '/auth/confirm'];

/**
 * Ververst bij elk verzoek de Supabase-sessie (anders verloopt hij na een
 * uur) en stuurt wie niet is ingelogd naar /login.
 */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (lijst) => {
          for (const { name, value } of lijst) req.cookies.set(name, value);
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of lijst) res.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const pad = req.nextUrl.pathname;

  if (!user && !OPEN.some((p) => pad.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
