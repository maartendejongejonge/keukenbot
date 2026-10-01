/**
 * Eenmalig koppelen van een Google Agenda.
 *
 * Draait op je EIGEN pc, niet op de VPS — de browser moet bij localhost kunnen.
 * Geen npm install nodig; alles komt uit Node zelf. Node 20 of hoger.
 *
 *   node koppel-agenda.mjs
 *
 * Aan het eind zie je een refresh token. Dat zet je in /opt/keukenbot/.env
 * op de VPS. Het token verloopt niet, tenzij je de toegang intrekt.
 */

import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const POORT = 3000;
const REDIRECT = `http://localhost:${POORT}/oauth/callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar';

const vraag = createInterface({ input: stdin, output: stdout });

const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim() ||
  (await vraag.question('Client ID: ')).trim();
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim() ||
  (await vraag.question('Client secret: ')).trim();
vraag.close();

if (!clientId || !clientSecret) {
  console.error('\nBeide velden zijn verplicht. Afgebroken.');
  process.exit(1);
}

// Willekeurige waarde die terug moet komen: zo weet je dat het antwoord
// bij jouw verzoek hoort en niet van iemand anders komt.
const state = crypto.randomUUID();

const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',   // zonder dit krijg je geen refresh token
  prompt: 'consent',        // forceert een nieuw token, ook bij herkoppelen
  state,
}).toString();

console.log('\nOpen deze link in je browser:\n');
console.log(url.toString());
console.log('\nWacht op je toestemming...\n');

const server = createServer(async (req, res) => {
  const binnen = new URL(req.url, `http://localhost:${POORT}`);
  if (binnen.pathname !== '/oauth/callback') {
    res.writeHead(404).end();
    return;
  }

  const code = binnen.searchParams.get('code');
  const fout = binnen.searchParams.get('error');

  if (fout || binnen.searchParams.get('state') !== state) {
    antwoord(res, 'Er ging iets mis. Kijk in je terminal.');
    console.error(fout ? `\nGoogle gaf terug: ${fout}` : '\nState klopt niet — afgebroken.');
    server.close();
    process.exit(1);
  }

  try {
    const token = await wisselIn(code);
    antwoord(res, 'Gelukt. Je kunt dit tabblad sluiten.');

    console.log('Gelukt. Zet deze regels in /opt/keukenbot/.env op de VPS:\n');
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${token}`);
    console.log(`GOOGLE_AGENDA_ID=primary\n`);
    console.log('Bewaar dit token als een wachtwoord: ermee kan iemand bij je agenda.\n');
  } catch (e) {
    antwoord(res, 'Inwisselen mislukt. Kijk in je terminal.');
    console.error(`\n${e.message}`);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(POORT, () => {});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPoort ${POORT} is bezet. Sluit wat daar draait en probeer opnieuw.`);
  } else {
    console.error(`\n${e.message}`);
  }
  process.exit(1);
});

async function wisselIn(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
      code,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    // De twee fouten die je hier in de praktijk krijgt, met hun oorzaak.
    if (data.error === 'redirect_uri_mismatch') {
      throw new Error(
        `De omleidings-URI komt niet overeen. In Google Cloud moet exact dit staan:\n  ${REDIRECT}`,
      );
    }
    if (data.error === 'invalid_client') {
      throw new Error('Client ID of secret klopt niet. Controleer op spaties aan het eind.');
    }
    throw new Error(`Inwisselen mislukt: ${data.error ?? res.status} ${data.error_description ?? ''}`);
  }

  if (!data.refresh_token) {
    throw new Error(
      'Geen refresh token ontvangen. Je hebt deze app eerder al toestemming gegeven.\n' +
        'Trek hem in op myaccount.google.com/permissions en probeer opnieuw.',
    );
  }

  return data.refresh_token;
}

function antwoord(res, tekst) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Keukenbot</title>
<body style="font-family:system-ui;padding:3rem;max-width:32rem">
<h1 style="font-size:1.25rem">Keukenbot</h1><p>${tekst}</p></body>`);
}
