/**
 * Gesprekstest: speelt echte (geanonimiseerde) klantgesprekken af tegen de
 * bot, met de echte prompt, het echte model en het profiel uit de database.
 * Er gaat niets naar WhatsApp en er komt niets in de agenda of de database.
 *
 *   cd /opt/keukenbot && sudo -u keukenbot npm run test:gesprekken
 *   sudo -u keukenbot npm run test:gesprekken -- doorverwijzing   (alleen gesprekken met dit woord in de id)
 *
 * Uitslag: in beeld en in test/uitslag.md. Naast elk botantwoord staat wat
 * Maarten destijds zelf schreef, en onderaan per gesprek de les waarop je
 * het antwoord beoordeelt.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { verwerkBericht, type LeadContext } from './orchestrator.js';
import { duidBericht } from './model.js';
import { prijzenActief, type PrijsProfiel, type Uurnormen } from './prijs.js';
import type { ReisProfiel } from './reiskosten.js';

for (const regel of readFileSync('.env', 'utf8').split('\n')) {
  const m = regel.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

interface Bericht { rol: 'klant' | 'monteur'; tijd: string; tekst: string }
interface Gesprek { id: string; bron: string; klus: string; taal: string; uitkomst: string; les: string; berichten: Bericht[] }

const MAX_BEURTEN = 8;
const filter = process.argv[2];
const gesprekken: Gesprek[] = JSON.parse(readFileSync('test/voorbeeldgesprekken.json', 'utf8'))
  .filter((g: Gesprek) => !filter || g.id.includes(filter));

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: rij, error } = await db
  .from('monteur_profielen')
  .select('*, monteurs!inner(bedrijfsnaam)')
  .eq('monteurs.bedrijfsnaam', 'Rotterdam Keukenmontage')
  .single();
if (error || !rij) {
  console.error('Profiel van Rotterdam Keukenmontage niet gevonden:', error?.message);
  process.exit(1);
}
const profiel = { ...rij, bedrijfsnaam: (rij as any).monteurs?.bedrijfsnaam ?? null };

const reisProfiel: ReisProfiel | null = profiel.vertrek_postcode
  ? {
      vertrekPc4: Number(profiel.vertrek_postcode),
      kmTarief: Number(profiel.km_tarief),
      uurtarief: Number(profiel.uurtarief ?? 0),
      reisuurPercentage: Number(profiel.reisuur_percentage),
      gratisPc4: profiel.gratis_pc4 ?? [],
      hotelRichtprijs: Number(profiel.hotel_richtprijs ?? 90),
    }
  : null;
const prijsProfiel: PrijsProfiel | null = prijzenActief(profiel)
  ? { uurtarief: Number(profiel.uurtarief), uurnormen: profiel.uurnormen as Uurnormen, reis: reisProfiel }
  : null;

/** Opeenvolgende klantberichten worden één beurt, net als de bundeling in de runner. */
function beurten(g: Gesprek): { klant: string; maarten: string }[] {
  const uit: { klant: string; maarten: string }[] = [];
  let klant: string[] = [];
  let maarten: string[] = [];
  const sluit = () => {
    if (klant.length) uit.push({ klant: klant.join('\n\n'), maarten: maarten.join('\n') });
    klant = [];
    maarten = [];
  };
  for (const b of g.berichten) {
    if (b.rol === 'klant') {
      if (maarten.length) sluit();
      klant.push(
        /^\[(\d+ )?foto/.test(b.tekst)
          ? `[klant stuurde ${b.tekst.replace(/[\[\]]/g, '')}; de inhoud is in deze test niet beschikbaar]`
          : b.tekst,
      );
    } else if (klant.length) {
      maarten.push(b.tekst);
    }
  }
  sluit();
  return uit;
}

const md: string[] = [`# Gesprekstest keukenbot`, '', `Gedraaid op ${new Date().toLocaleString('nl-NL')}`, ''];
const log = (s = '') => { console.log(s); md.push(s); };

for (const g of gesprekken) {
  log(`## ${g.id}`);
  log(`_${g.bron} · ${g.klus} · destijds: ${g.uitkomst}_`);
  log();

  const ctx: LeadContext = { kwalificatie: {}, vervolgvragen: 0, historie: [] };
  let einde = 'klantberichten op';

  for (const [i, beurt] of beurten(g).slice(0, MAX_BEURTEN).entries()) {
    const besluit = await verwerkBericht(beurt.klant, ctx, profiel, {
      duidBericht,
      bezetting: async () => [],       // lege agenda: elke datum is vrij
    }, prijsProfiel);

    const bot = besluit.soort === 'overdracht' ? `(overdracht: ${besluit.samenvatting})` : besluit.tekst;
    const sig = 'signalen' in besluit && besluit.signalen.length ? `  \n  _seintje: ${besluit.signalen.join(', ')}_` : '';
    log(`**${i + 1}. Klant:** ${beurt.klant.replace(/\n+/g, ' / ')}`);
    log(`- **Bot (${besluit.soort}):** ${bot.replace(/\n+/g, ' / ')}${sig}`);
    if (beurt.maarten) log(`- _Maarten destijds:_ ${beurt.maarten.replace(/\n+/g, ' / ')}`);
    log();

    ctx.historie.push({ afzender: 'klant', tekst: beurt.klant }, { afzender: 'bot', tekst: bot });
    ctx.vervolgvragen++;
    if ('kwalificatie' in besluit && besluit.kwalificatie) ctx.kwalificatie = besluit.kwalificatie;
    if ('prijs' in besluit && besluit.prijs && !ctx.prijsGegeven) {
      ctx.prijsGegeven = {
        min: besluit.prijs.min, max: besluit.prijs.max, incl_btw: besluit.prijs.incl_btw,
        dagen_min: besluit.prijs.dagen_min, dagen_max: besluit.prijs.dagen_max, posten: besluit.prijs.posten,
      };
    }
    if (besluit.soort !== 'antwoord') { einde = besluit.soort; break; }
  }

  log(`**Einde:** ${einde} · **Bekend:** \`${JSON.stringify(ctx.kwalificatie)}\``);
  log();
  log(`**Beoordeel op:** ${g.les}`);
  log();
}

writeFileSync('test/uitslag.md', md.join('\n'));
console.log('Uitslag ook bewaard in test/uitslag.md');
