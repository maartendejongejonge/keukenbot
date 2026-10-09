/**
 * Controle vóór het starten: klopt de .env en werken alle koppelingen?
 *
 *   cd /opt/keukenbot && sudo -u keukenbot npm run check
 *
 * Raakt WhatsApp niet aan; die koppel je pas als dit allemaal groen is.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// .env zelf inlezen; systemd doet dat straks via EnvironmentFile.
try {
  for (const regel of readFileSync('.env', 'utf8').split('\n')) {
    const m = regel.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  console.log('✗ geen .env gevonden in deze map');
  process.exit(1);
}

let fouten = 0;
const goed = (m: string) => console.log(`✓ ${m}`);
const fout = (m: string) => { console.log(`✗ ${m}`); fouten++; };

// ------------------------------------------------------------------ .env
const verplicht = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY',
  'WHATSAPP_NUMMER', 'MONTEUR_WHATSAPP',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
];
for (const n of verplicht) {
  if (!process.env[n]) fout(`.env mist ${n}`);
}
for (const n of ['WHATSAPP_NUMMER', 'MONTEUR_WHATSAPP']) {
  const v = process.env[n] ?? '';
  if (v && !/^31\d{9}$/.test(v)) fout(`${n} moet 31 + 9 cijfers zijn, zonder + of spaties (nu: ${v})`);
}
const meelezen = (process.env.MEELEZEN ?? 'true').toLowerCase() !== 'false';
console.log(`  modus: ${meelezen ? 'MEELEZEN (klant krijgt niets)' : 'LIVE — klanten krijgen antwoord!'}`);

// -------------------------------------------------------------- supabase
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await db
    .from('kanalen')
    .select('monteur_id, monteurs(bedrijfsnaam)')
    .eq('soort', 'whatsapp')
    .eq('externe_id', process.env.WHATSAPP_NUMMER ?? '')
    .eq('actief', true)
    .maybeSingle();
  if (error) fout(`Supabase: ${error.message}`);
  else if (!data) fout(`Supabase werkt, maar er is geen actief WhatsApp-kanaal voor ${process.env.WHATSAPP_NUMMER}`);
  else goed(`Supabase: kanaal hoort bij ${(data as any).monteurs?.bedrijfsnaam ?? data.monteur_id}`);
}

// ---------------------------------------------------------------- google
if (process.env.GOOGLE_REFRESH_TOKEN) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const j: any = await res.json();
  if (!j.access_token) {
    fout(`Google: ${j.error ?? res.status} ${j.error_description ?? ''}`.trim());
    if (j.error === 'invalid_grant') {
      console.log('    Het token is verlopen of ingetrokken. Draai koppel-agenda.mjs opnieuw');
      console.log('    op je laptop. Staat je Google-app op "Testen", dan verloopt het na 7');
      console.log('    dagen: zet hem in Google Cloud op "In productie".');
    }
  } else {
    const agenda = encodeURIComponent(process.env.GOOGLE_AGENDA_ID || 'primary');
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${agenda}`, {
      headers: { authorization: `Bearer ${j.access_token}` },
    });
    const a: any = await r.json();
    if (r.ok) goed(`Google Agenda: ${a.summary}`);
    else fout(`Google Agenda: ${a.error?.message ?? r.status}`);
  }
}

// ------------------------------------------------------------- anthropic
if (process.env.ANTHROPIC_API_KEY) {
  const modellen = new Set([
    process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    process.env.CLAUDE_MODEL_MEDIA || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  ]);
  for (const model of modellen) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Zeg alleen: ok' }] }),
    });
    const j: any = await res.json();
    if (res.ok) goed(`Anthropic: model ${j.model} antwoordt`);
    else fout(`Anthropic (${model}): ${j.error?.message ?? res.status}`);
  }
}

console.log(fouten ? `\n${fouten} probleem/problemen — eerst oplossen.` : '\nAlles groen. Je kunt WhatsApp koppelen.');
process.exit(fouten ? 1 : 0);
