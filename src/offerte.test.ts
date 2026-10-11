/**
 * Offertevoorstel testen zonder WhatsApp.
 *
 *   npm run test:offerte                 rekentest op de referentiekeuken (geen model nodig)
 *   npm run test:offerte -- lijst.pdf    leest een echte onderdelenlijst met Claude uit
 *
 * De PDF komt in test/offerte-voorbeeld.pdf. Bekijk hem en de controlelijst.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  berekenOfferte, berichtVoorMonteur, leesStuklijst, offertePdf, offertenummer, normaliseerStuklijst,
  type OfferteProfiel, type Stuklijst,
} from './offerte.js';

/** IKEA-keuken "Ikea nr 2" (10-10-2026), handmatig geteld. */
const REFERENTIE: Stuklijst = normaliseerStuklijst({
  merk: 'IKEA', levering: 'bouwpakket', opstelling: 'hoek',
  onderkasten: 5, hoekkasten: 1, hangkasten: 9, hoge_kasten: 4, lades: 11, fronten: 30,
  plinten: 4, bedekkingspanelen: 6, passtukken: 3,
  werkblad_delen: 2, werkblad_materiaal: 'EKBACKEN laminaat', werkblad_zwaar: false,
  wandpanelen: 6, verlichting: 5,
  apparaten: ['inbouw koel-vriescombinatie', 'oven', 'vaatwasser', 'inductiekookplaat'], spoelbak: true,
  omschrijving: 'IKEA METOD-keuken met ASPUDDEN-fronten in L-opstelling met hoge-kastenwand; werkblad EKBACKEN in 2 delen en LYSEKIL-achterwand.',
  zeker: true, onduidelijk: ['Apparatuur staat niet in de IKEA-lijst; aangenomen op basis van de kasten.'],
});

const PROFIEL: OfferteProfiel = {
  aan: true, naam: 'Rotterdam Keukenmontage', juridisch: 'M.P.J. de Jonge',
  regel: 'Keukenmontage & elektrotechniek', web: 'rotterdam-keukenmontage.nl',
  adres: '[adres]', postcode_plaats: '[postcode] Rotterdam', telefoon: '[telefoon]', email: '[e-mail]',
  kvk: '[KvK]', btw_id: '[btw-id]', meerwerk_uurtarief: 56,
};

async function main() {
  const pad = process.argv[2];
  let s = REFERENTIE;
  if (pad) {
    console.log(`Uitlezen: ${pad} …`);
    s = await leesStuklijst([{ bytes: readFileSync(pad), mime: 'application/pdf', bestandsnaam: pad }],
      'Klant: hier de lijst. De apparatuur komt er nog bij.');
    console.log(JSON.stringify(s, null, 1));
  }

  const ctx = { klant_naam: null, plaats: 'Rotterdam', pc4: 3028, werkblad_door: 'monteur' as const };
  const o = berekenOfferte(s, ctx, PROFIEL);
  const nr = offertenummer('a1b2c3d4-0000', new Date('2026-10-11T10:00:00Z'));
  console.log('\n' + berichtVoorMonteur(o, s, nr, 'testklant'));
  console.log('\nPosten:');
  for (const p of o.posten) console.log(`  ${p.bedrag.toFixed(2).padStart(9)}  ${p.oms}`);

  if (!pad) {
    // Referentie: ca. € 2.780 excl. btw (bovenkant markt, zie offerte.ts).
    const ok = Math.abs(o.totaal_excl - 2778) < 1 && o.dagen_min === 4 && o.dagen_max === 5;
    console.log(ok ? '\nRekentest OK' : `\nRekentest MISLUKT: ${o.totaal_excl} excl., ${o.dagen_min}–${o.dagen_max} dagen`);
    if (!ok) process.exitCode = 1;
  }

  writeFileSync('test/offerte-voorbeeld.pdf', await offertePdf(o, ctx, PROFIEL, { offertenummer: nr, datum: new Date() }));
  console.log('PDF: test/offerte-voorbeeld.pdf');
}

main().catch((e) => { console.error(e); process.exit(1); });
