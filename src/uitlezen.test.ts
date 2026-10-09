/**
 * Uitleestest: leest echte onderdelenlijsten en tekeningen uit en vergelijkt
 * de telling met wat jij zelf hebt geteld. Zo weet je of het uitlezen (en een
 * ander model in CLAUDE_MODEL_MEDIA) echt beter wordt.
 *
 * De bestanden zelf staan NIET in GitHub (de repo is openbaar en het zijn
 * klantgegevens). Zet ze op de server in test/bestanden/ met daarnaast
 * test/bestanden/verwacht.json, in het formaat van test/bestanden.voorbeeld.json.
 *
 *   sudo -u keukenbot -H bash -c 'cd /opt/keukenbot && npm run test:uitlezen'
 *   ... npm run test:uitlezen -- ikea          (alleen sets met dit woord in de id)
 *   ... CLAUDE_MODEL_MEDIA=claude-sonnet-4-6 npm run test:uitlezen   (ander model proberen)
 *
 * Uitslag in beeld en in test/bestanden/uitslag.md.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
if (!existsSync(MANIFEST)) {
  console.error(`${MANIFEST} ontbreekt. Zet je testbestanden in ${MAP}/ en maak verwacht.json naar het voorbeeld in test/bestanden.voorbeeld.json.`);
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
};

const filter = process.argv[2];
const sets: Set[] = JSON.parse(readFileSync(MANIFEST, 'utf8')).filter((s: Set) => !filter || s.id.includes(filter));
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

  console.log(`\n${alles ? 'GOED' : 'FOUT'}  ${s.id} (${s.bestanden.length} bestanden, ${sec} s)`);
  for (const r of regels) console.log(`  ${r.ok ? '✓' : '✗'} ${r.v}: verwacht ${r.verwacht}, kreeg ${r.gekregen ?? '—'}`);
  if (!telling) console.log('  geen [telling]-regel gevonden');

  md.push(
    `## ${alles ? '✓' : '✗'} ${s.id}\n`,
    s.omschrijving ? `${s.omschrijving}\n` : '',
    `Bestanden: ${s.bestanden.join(', ')} (${sec} s)\n`,
    '| veld | verwacht | gekregen |', '| --- | --- | --- |',
    ...regels.map((r) => `| ${r.ok ? '' : '**'}${r.v}${r.ok ? '' : '**'} | ${r.verwacht} | ${r.gekregen ?? '—'} |`),
    '', '<details><summary>Samenvatting</summary>\n', '```', tekst, '```', '</details>\n',
  );
}

const score = `${goed} van ${totaal} velden goed`;
console.log(`\n${score}. Uitslag in ${join(MAP, 'uitslag.md')}`);
md.splice(1, 0, `**${score}**\n`);
writeFileSync(join(MAP, 'uitslag.md'), md.join('\n'));
