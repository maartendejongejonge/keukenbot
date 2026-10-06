import 'server-only';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const STATE_COOKIE = 'kb_google_state';

export const googleRedirect = () => `${process.env.SITE_URL}/api/google/callback`;

export function googleAutorisatieUrl(state: string, email?: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_WEB_CLIENT_ID!,
    redirect_uri: googleRedirect(),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline', // zonder dit geen refresh token
    prompt: 'consent',      // ook bij opnieuw koppelen een nieuw refresh token
    include_granted_scopes: 'true',
    state,
    ...(email ? { login_hint: email } : {}),
  }).toString();
  return url.toString();
}

export async function wisselCode(code: string): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_WEB_CLIENT_ID!,
      client_secret: process.env.GOOGLE_WEB_CLIENT_SECRET!,
      redirect_uri: googleRedirect(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google gaf ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Het e-mailadres van de hoofdagenda; de agenda-id van 'primary'. */
export async function hoofdagenda(accessToken: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data.id === 'string' ? data.id : null;
}

export async function trekIn(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}
