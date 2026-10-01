/**
 * Google Agenda-koppeling.
 *
 * Drie taken:
 *   1. bezetting()  — wat staat er al, zodat de planner geen dubbele boeking doet
 *   2. vastleggen() — een bevestigde afspraak als echte agenda-afspraak wegschrijven
 *   3. opruimen()   — voorlopige reserveringen die verlopen zijn weggooien
 *
 * Voorlopige reserveringen staan bewust NIET in Google. Ze leven in de eigen
 * database tot de klant bevestigt. Anders staat de agenda van de monteur vol
 * met afspraken die niet doorgaan, en dat is precies het vertrouwen dat je
 * bij een monteur niet mag verspelen.
 */

import type { Bezetting } from './planner.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

/**
 * Werkafspraken krijgen een vaste kleur, zodat ze in dezelfde agenda
 * herkenbaar blijven naast privé-afspraken. 9 = Blueberry (donkerblauw).
 * Andere blauwtinten: 1 = Lavender (lichtpaars), 7 = Peacock (lichtblauw).
 */
const WERK_KLEUR = '9';

export interface GoogleKoppeling {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  agendaId: string;      // meestal 'primary'
}

/** Access tokens leven een uur; we halen er één op en houden hem vast. */
const tokenCache = new Map<string, { token: string; verlooptOp: number }>();

async function accessToken(k: GoogleKoppeling): Promise<string> {
  const cached = tokenCache.get(k.refreshToken);
  if (cached && cached.verlooptOp > Date.now() + 60_000) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: k.clientId,
      client_secret: k.clientSecret,
      refresh_token: k.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    // Een ingetrokken token is geen tijdelijke storing: de monteur moet
    // opnieuw koppelen. Dat moet zichtbaar zijn, niet stilletjes falen.
    throw new Error(`Google-token vernieuwen mislukt (${res.status}). Opnieuw koppelen nodig.`);
  }

  const data = await res.json();
  tokenCache.set(k.refreshToken, {
    token: data.access_token,
    verlooptOp: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

// ---------------------------------------------------------------- lezen

/**
 * Bezette tijden via freeBusy. Dat geeft alleen begin- en eindtijden terug,
 * geen inhoud — precies genoeg voor de planner en niet meer dan nodig.
 *
 * Kanttekening: freeBusy kent geen postcodes, dus de reistijdregels in de
 * planner werken alleen voor afspraken die de bot zelf heeft gemaakt. Die
 * staan mét pc4 in de eigen database; die vullen we hier aan.
 */
export async function bezetting(
  k: GoogleKoppeling,
  vanaf: Date,
  dagen: number,
  eigenAfspraken: Bezetting[] = [],
): Promise<Bezetting[]> {
  const tot = new Date(+vanaf + dagen * 24 * 60 * 60 * 1000);
  const token = await accessToken(k);

  const res = await fetch(`${API}/freeBusy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: vanaf.toISOString(),
      timeMax: tot.toISOString(),
      timeZone: 'Europe/Amsterdam',
      items: [{ id: k.agendaId }],
    }),
  });

  if (!res.ok) throw new Error(`freeBusy mislukt (${res.status})`);

  const data = await res.json();
  const blokken: { start: string; end: string }[] =
    data.calendars?.[k.agendaId]?.busy ?? [];

  const uitGoogle: Bezetting[] = blokken.map((b) => ({
    start: new Date(b.start),
    eind: new Date(b.end),
  }));

  // Eigen afspraken hebben een postcode; die versie wint bij overlap.
  const resultaat = [...eigenAfspraken];
  for (const g of uitGoogle) {
    const alBekend = eigenAfspraken.some(
      (e) => Math.abs(+e.start - +g.start) < 60_000 && Math.abs(+e.eind - +g.eind) < 60_000,
    );
    if (!alBekend) resultaat.push(g);
  }

  return resultaat.sort((a, b) => +a.start - +b.start);
}

// --------------------------------------------------------------- schrijven

export interface AfspraakGegevens {
  soort: 'inmeting' | 'montage';
  start: Date;
  eind: Date;
  klantNaam?: string;
  klantTelefoon?: string;
  adres?: string;
  notitie?: string;
}

/**
 * Schrijft een bevestigde afspraak weg. Geeft het Google-event-id terug,
 * zodat je hem later kunt wijzigen of annuleren.
 */
export async function vastleggen(
  k: GoogleKoppeling,
  a: AfspraakGegevens,
): Promise<string> {
  const token = await accessToken(k);

  const titel =
    a.soort === 'inmeting'
      ? `Inmeting${a.klantNaam ? ` — ${a.klantNaam}` : ''}`
      : `Keukenmontage${a.klantNaam ? ` — ${a.klantNaam}` : ''}`;

  const omschrijving = [
    a.klantTelefoon ? `Tel: ${a.klantTelefoon}` : null,
    a.notitie,
    'Ingepland via de bot.',
  ]
    .filter(Boolean)
    .join('\n');

  const body =
    a.soort === 'montage'
      ? {
          // Montage beslaat hele dagen; een blok van 07:00 tot 20:00 over
          // drie dagen klopt niet met hoe een agenda dat toont.
          summary: titel,
          description: omschrijving,
          location: a.adres,
          colorId: WERK_KLEUR,
          start: { date: datum(a.start) },
          end: { date: datum(new Date(+a.eind + 24 * 60 * 60 * 1000)) }, // einddatum is exclusief
        }
      : {
          summary: titel,
          description: omschrijving,
          location: a.adres,
          colorId: WERK_KLEUR,
          start: { dateTime: a.start.toISOString(), timeZone: 'Europe/Amsterdam' },
          end: { dateTime: a.eind.toISOString(), timeZone: 'Europe/Amsterdam' },
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
        };

  const res = await fetch(`${API}/calendars/${encodeURIComponent(k.agendaId)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Afspraak wegschrijven mislukt (${res.status})`);

  const data = await res.json();
  return data.id as string;
}

export async function annuleren(k: GoogleKoppeling, eventId: string): Promise<void> {
  const token = await accessToken(k);
  const res = await fetch(
    `${API}/calendars/${encodeURIComponent(k.agendaId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  // 410 betekent: stond er al niet meer. Prima.
  if (!res.ok && res.status !== 410) {
    throw new Error(`Annuleren mislukt (${res.status})`);
  }
}

function datum(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ------------------------------------------------------------------ OAuth
// Eenmalig per monteur: hij klikt op een link, geeft toestemming, en jij
// slaat het refresh token op. Daarna is er geen handeling meer nodig.

export function toestemmingsUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',      // nodig voor een refresh token
    prompt: 'consent',           // anders krijg je bij een tweede koppeling geen nieuw token
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function wisselCodeIn(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<{ refreshToken: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code,
    }),
  });

  if (!res.ok) throw new Error(`Code inwisselen mislukt (${res.status})`);

  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error(
      'Geen refresh token ontvangen. Koppeling bestond al — trek hem in bij ' +
        'myaccount.google.com/permissions en probeer opnieuw.',
    );
  }
  return { refreshToken: data.refresh_token };
}
