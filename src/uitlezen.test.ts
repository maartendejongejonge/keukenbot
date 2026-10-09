/**
 * Uitleestest: laat zien wat Pico uit een document of foto haalt.
 *
 * Zonder verwacht.json (de gewone manier): elk bestand in test/bestanden/
 * wordt los uitgelezen, en je ziet per bestand de volledige samenvatting en
 * de telling. Die controleer je zelf.
 *
 *   sudo -u keukenbot -H bash -c 'cd /opt/keukenbot && npm run test:uitlezen'
 *   ... npm run test:uitlezen -- ikea      (alleen bestanden met dit woord in de naam)
 *
 * Met test/bestanden/verwacht.json (optioneel, formaat zie
 * test/bestanden.voorbeeld.json) worden bestanden per set samen gelezen en
 * vergeleken met jouw eigen telling.
 *
 * De bestanden staan NIET in GitHub (de repo is openbaar en het zijn
 * klantgegevens).
 *
 *   sudo -u keukenbot -H bash -c 'cd /opt/keukenbot && npm run test:uitlezen'
 *   ... npm run test:uitlezen -- ikea          (alleen sets met dit woord in de id)
 *   ... CLAUDE_MODEL_MEDIA=claude-sonnet-4-6 npm run test:uitlezen   (ander model proberen)
 *
 * Uitslag in beeld en in test/bestanden/uitslag.md.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { leesBestanden, leesTelling, mediaModel, type TeLezen, type Telling } from './media.js';

if (existsSync('.env')) {
  for (const regel of readFileSync('.env', 'utf8').split('\n')) {
    const m = regel.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

interface Set {
  id: string;
  omschrijving?: string;
  bestanden: string[];
  verwacht: Partial<Telling>;
}

const MAP = 'test/bestanden';
const MANIFEST = join(MAP, 'verwacht.json');
if (!existsSync(MAP)) {
  console.error(`Map ${MAP}/ bestaat niet. Zet daar de documenten en foto's die je wilt laten uitlezen.`);
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
};

const filter = process.argv[2];
const metVerwachting = existsSync(MANIFEST);
const sets: Set[] = (metVerwachting
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : readdirSync(MAP)
      .filter((n) => MIME[extname(n).toLowerCase()])
      .sort()
      .map((n) => ({ id: n, bestanden: [n], verwacht: {} }))
).filter((s: Set) => !filter || s.id.includes(filter));

if (!sets.length) {
  console.error(`Geen bestanden gevonden in ${MAP}/ (pdf, jpg, png, webp, gif)${filter ? ` met "${filter}" in de naam` : ''}.`);
  process.exit(1);
}
console.log(`${sets.length} ${metVerwachting ? 'sets' : 'bestanden'} uitlezen met ${mediaModel()}. Dit duurt per bestand 10 tot 60 seconden.`);
const VELDEN: (keyof Telling)[] = ['onderkasten', 'hangkasten', 'hoge_kasten', 'levering', 'zeker'];

const md: string[] = [`# Uitleestest\n\nModel: \`${mediaModel()}\`, ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n`];
let goed = 0;
let totaal = 0;

for (const s of sets) {
  const bestanden: TeLezen[] = s.bestanden.map((naam) => ({
    bytes: readFileSync(join(MAP, naam)),
    mime: MIME[extname(naam).toLowerCase()] ?? 'application/octet-stream',
    bestandsnaam: naam,
  }));

  console.log(`\n--- ${s.id}: bezig...`);
  let tekst = '';
  let telling: Telling | null = null;
  const start = Date.now();
  try {
    tekst = await leesBestanden(bestanden);
    telling = leesTelling(tekst);
  } catch (e) {
    tekst = `FOUT: ${String(e)}`;
  }
  const sec = ((Date.now() - start) / 1000).toFixed(1);

  const regels = VELDEN.filter((v) => s.verwacht[v] !== undefined).map((v) => {
    const verwacht = s.verwacht[v];
    const gekregen = telling ? telling[v] : undefined;
    const ok = gekregen === verwacht;
    totaal++;
    if (ok) goed++;
    return { v, verwacht, gekregen, ok };
  });
  const alles = regels.every((r) => r.ok);

  if (regels.length) {
    console.log(`${alles ? 'GOED' : 'FOUT'}  ${s.id} (${s.bestanden.length} bestanden, ${sec} s)`);
    for (const r of regels) console.log(`  ${r.ok ? '✓' : '✗'} ${r.v}: verwacht ${r.verwacht}, kreeg ${r.gekregen ?? '—'}`);
  } else {
    // Geen verwachting: laat zien wat Pico ervan maakt, jij controleert.
    console.log(`(${sec} s)\n${tekst}`);
  }
  if (!telling) console.log('  let op: geen [telling]-regel gevonden; Pico weet dan niet of de aantallen zeker zijn');

  md.push(
    `## ${regels.length ? (alles ? '✓ ' : '✗ ') : ''}${s.id}\n`,
    s.omschrijving ? `${s.omschrijving}\n` : '',
    `Bestanden: ${s.bestanden.join(', ')} (${sec} s)\n`,
    ...(regels.length
      ? ['| veld | verwacht | gekregen |', '| --- | --- | --- |',
         ...regels.map((r) => `| ${r.ok ? '' : '**'}${r.v}${r.ok ? '' : '**'} | ${r.verwacht} | ${r.gekregen ?? '—'} |`), '']
      : []),
    '```', tekst, '```\n',
  );
}

const score = totaal ? `${goed} van ${totaal} velden goed` : `${sets.length} bestanden uitgelezen`;
console.log(`\n${score}. Alles nog eens rustig nalezen: ${join(MAP, 'uitslag.md')}`);
md.splice(1, 0, `**${score}**\n`);
writeFileSync(join(MAP, 'uitslag.md'), md.join('\n'));
