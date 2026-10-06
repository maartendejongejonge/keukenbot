# Keukenbot — webinterface

De website waar een monteur inlogt, zijn instellingen invult, zijn Google
Agenda koppelt en ziet wat de bot met zijn klanten heeft besproken. Jij
(beheerder) nodigt hier monteurs uit en koppelt hun WhatsApp-nummer.

Next.js op Vercel, met dezelfde Supabase-database als de runner. Alleen op
uitnodiging: wie geen rij in `monteurs` heeft, komt er niet in.

## Wat erin zit

| Pagina | Wat |
| --- | --- |
| `/login` | Inloggen met e-mail: link of code, geen wachtwoord |
| `/` | Overzicht: wat op jou wacht (seintjes), afspraken, lopende gesprekken, cijfers van 30 dagen, de eerste stappen |
| `/gesprekken` | Alle aanvragen met status; per gesprek de WhatsApp-berichten en wat de bot weet |
| `/instellingen` | Werktijden, werkgebied, planning, reiskosten, prijsindicatie en uurnormen, klusjes, transport, toon, wat hij niet doet |
| `/koppelingen` | Google Agenda koppelen en ontkoppelen; status van WhatsApp en seintjes |
| `/beheer` | Alleen voor `BEHEERDERS`: monteur uitnodigen, inloglink maken, WhatsApp-nummer koppelen, abonnement, pauzeren |

## Beveiliging in het kort

- De browser praat met Supabase als de ingelogde monteur. RLS en kolomrechten
  (migratie `0006_webinterface.sql`) laten hem alleen zijn eigen rijen zien
  en alleen zijn eigen instellingen en seintjes wijzigen. Getest: een andere
  monteur ziet 0 leads van Rotterdam Keukenmontage, en WhatsApp-nummer,
  abonnement en leads aanpassen wordt geweigerd.
- Google-tokens staan in `google_koppelingen`, een tabel zonder policies: alleen
  de server en de runner (service role) kunnen hem lezen.
- `SUPABASE_SERVICE_ROLE_KEY` en `GOOGLE_WEB_CLIENT_SECRET` staan alleen in
  Vercel, nooit in de repo (die is openbaar).

## Eenmalig inrichten

Volgorde aanhouden: de URL van Vercel heb je nodig bij Supabase en Google.

### 1. Vercel

1. Vercel → Add New → Project → de GitHub-repo `keukenbot`.
2. **Root Directory: `web`**. Framework: Next.js (vanzelf).
3. Environment Variables: alles uit `.env.voorbeeld`.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase → Project Settings → API keys
     (de *publishable* key mag ook).
   - `SUPABASE_SERVICE_ROLE_KEY`: dezelfde als in `/opt/keukenbot/.env`.
   - `SITE_URL`: eerst `https://<projectnaam>.vercel.app`; later je eigen
     domein, bijvoorbeeld `https://app.rotterdamkeukenmontage.nl`.
4. Deploy.

### 2. Supabase → Authentication

1. **URL Configuration**: Site URL = je `SITE_URL`. Redirect URLs:
   `<SITE_URL>/auth/confirm`.
2. **Sign In / Providers → Email**: *Allow new users to sign up* **uit**.
   Uitnodigen gaat via de beheerpagina en werkt dan nog steeds.
3. **Email Templates → Magic Link**: vervang de link, zodat hij op elk
   apparaat werkt (ook als iemand de mail op zijn telefoon opent en op de
   laptop inlogt) en zet de code erbij:

   ```html
   <h2>Inloggen bij Keukenbot</h2>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Inloggen</a></p>
   <p>Of typ deze code: <strong>{{ .Token }}</strong></p>
   ```
4. **SMTP**: de ingebouwde mailer van Supabase stuurt alleen naar leden van je
   eigen Supabase-team. Voor andere monteurs heb je een eigen mailer nodig
   (Project Settings → Authentication → SMTP), bijvoorbeeld Resend (gratis tot
   3.000 mails per maand) of je Gmail met een app-wachtwoord.
   Zolang dat er niet is: maak op `/beheer` een inloglink en stuur die zelf
   via WhatsApp.
5. Optioneel: **Email OTP Expiration** op 86400 (24 uur), dan blijft een
   inloglink uit de beheerpagina een dag geldig in plaats van een uur.

### 3. Google Cloud (zelfde project als je huidige agenda-koppeling)

1. APIs & Services → Credentials → Create credentials → OAuth client ID →
   type **Web application**.
2. Authorized redirect URI: `<SITE_URL>/api/google/callback`.
3. Client ID en secret in Vercel (`GOOGLE_WEB_CLIENT_ID`,
   `GOOGLE_WEB_CLIENT_SECRET`) **en** in `/opt/keukenbot/.env` op de VPS.
4. OAuth consent screen → Publishing status op **In production** zetten.
   In *Testing* verloopt elk token na zeven dagen en kan alleen een handvol
   testgebruikers koppelen. Zonder Google-verificatie zien monteurs bij het
   koppelen een waarschuwing "Google heeft deze app niet geverifieerd"
   (Geavanceerd → Doorgaan). Dat mag tot 100 gebruikers; verificatie aanvragen
   kan later.

### 4. De runner op de VPS bijwerken

```bash
ssh maartendejonge24@149.210.205.238
cd ~/keukenbot && git pull
sudo nano /opt/keukenbot/.env     # GOOGLE_WEB_CLIENT_ID en GOOGLE_WEB_CLIENT_SECRET toevoegen
sudo bash deploy/installeer-app.sh
sudo systemctl restart keukenbot
journalctl -u keukenbot -f
```

De runner werkt meteen zoals voorheen: zolang Rotterdam Keukenmontage geen
koppeling in de webinterface heeft, gebruikt hij `GOOGLE_REFRESH_TOKEN` uit
de `.env`.

### 5. Zelf als eerste gebruiker

1. Log in op `<SITE_URL>` met maartendejongejonge@gmail.com. Je login wordt
   dan vanzelf aan Rotterdam Keukenmontage gekoppeld.
2. Instellingen → vul **je eigen mobiele nummer** in (seintjes) en sla op.
3. Koppelingen → **Koppel Google Agenda**. Vanaf nu gebruikt de runner deze
   koppeling in plaats van die uit de `.env`.

## Een monteur toevoegen

1. `/beheer` → Monteur uitnodigen. Je krijgt een inloglink en een kant-en-klaar
   bericht om via WhatsApp te sturen.
2. Hij logt in, vult zijn instellingen in en koppelt zijn agenda. Op
   `/beheer` zie je per monteur hoe ver hij is.
3. WhatsApp-nummer koppelen doe jij op `/beheer`, bij de inrichting.

**Let op:** de runner luistert nu op één WhatsApp-nummer (`WHATSAPP_NUMMER`).
Een tweede monteur met een eigen nummer krijgt pas antwoorden als de runner
meerdere nummers aankan of na de overstap naar de officiële WhatsApp Business
API. Al het andere (instellingen, agenda, seintjes, gesprekken) werkt per
monteur.

## Lokaal draaien

```bash
cd web
cp .env.voorbeeld .env.local   # en invullen, SITE_URL=http://localhost:3000
npm install
npm run dev
```
