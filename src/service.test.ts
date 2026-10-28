/**
 * Rekentest serviceklussen (staffel 28-10-2026) en regio.
 * Draaien: npm run build && node dist/service.test.js
 */
import assert from 'node:assert/strict';
import { berekenService, serviceTekst, serviceReiskosten, zoneVoor } from './service.js';

let fouten = 0;
function test(naam: string, f: () => void) {
  try {
    f();
    console.log(`ok   ${naam}`);
  } catch (e) {
    fouten++;
    console.log(`FOUT ${naam}\n     ${(e as Error).message}`);
  }
}

const reisRKM = { vertrekPc4: 3028, kmTarief: 0.35, uurtarief: 56, reisuurPercentage: 50, gratisPc4: [] };

test('vaatwasser inbouwen', () => {
  const b = berekenService([{ code: 'vaatwasser_inbouwen' }]);
  assert.equal(b.arbeid, 225);
  assert.equal(b.duurMin, 120);
});

test('oude vaatwasser eruit samen met inbouwen = € 60', () => {
  const b = berekenService([{ code: 'vaatwasser_inbouwen' }, { code: 'vaatwasser_verwijderen' }]);
  assert.equal(b.arbeid, 285);
});

test('oude vaatwasser los = € 125', () => {
  assert.equal(berekenService([{ code: 'vaatwasser_verwijderen' }]).arbeid, 125);
});

test('fronten per stuk met minimum', () => {
  assert.equal(berekenService([{ code: 'front', aantal: 2 }]).arbeid, 95);
  assert.equal(berekenService([{ code: 'front', aantal: 8 }]).arbeid, 200);
});

test('afstellen per blok van 10', () => {
  assert.equal(berekenService([{ code: 'afstellen', aantal: 10 }]).arbeid, 95);
  assert.equal(berekenService([{ code: 'afstellen', aantal: 14 }]).arbeid, 190);
});

test('werkblad + 2 hoekverbindingen + dubbele code samengevoegd', () => {
  const b = berekenService([{ code: 'werkblad' }, { code: 'werkblad_extra' }, { code: 'werkblad_extra' }]);
  assert.equal(b.arbeid, 595 + 190);
});

test('onbekende code telt niet mee maar wordt gemeld', () => {
  const b = berekenService([{ code: 'kraan' }, { code: 'spatwand_tegelen' }]);
  assert.equal(b.arbeid, 129);
  assert.deepEqual(b.onbekend, ['spatwand_tegelen']);
});

test('zone: plaatsen en wijken', () => {
  assert.equal(zoneVoor('Spijkenisse').status, 'gratis');
  assert.equal(zoneVoor('Spijkernisse').status, 'gratis'); // tikfout
  assert.equal(zoneVoor('Kralingen').gemeente, 'Rotterdam');
  assert.equal(zoneVoor('Rotterdam-Zuid').gemeente, 'Rotterdam');
  assert.equal(zoneVoor('Hoogvliet').status, 'gratis');
  assert.equal(zoneVoor("'s-Gravenzande").gemeente, 'Westland');
  assert.equal(zoneVoor('Hellevoetsluis').gemeente, 'Voorne aan Zee');
  assert.equal(zoneVoor('Zoetermeer').status, 'gratis');
  assert.equal(zoneVoor('Capelle').status, 'gratis');
  assert.equal(zoneVoor('Den Haag').status, 'betaald');
  assert.equal(zoneVoor("'s-Gravenhage").status, 'betaald');
  assert.equal(zoneVoor('Gouda').status, 'betaald');
  assert.equal(zoneVoor('Utrecht').status, 'onbekend');
  assert.equal(zoneVoor('').status, 'onbekend');
});

test('reiskosten: gratis 0, Den Haag > 0, onbekend null', () => {
  assert.equal(serviceReiskosten(zoneVoor('Delft'), reisRKM), 0);
  assert.ok((serviceReiskosten(zoneVoor('Den Haag'), reisRKM) ?? 0) > 0);
  assert.equal(serviceReiskosten(zoneVoor('Utrecht'), reisRKM), null);
});

test('prijstekst bevat de vier vaste onderdelen', () => {
  const b = berekenService([{ code: 'kraan' }, { code: 'afzuigkap' }]);
  const t = serviceTekst(b, zoneVoor('Dordrecht'), 0, 'Dordrecht', 'Jos');
  assert.match(t, /€ 324/);
  assert.match(t, /- keukenkraan vervangen: € 129/);
  assert.match(t, /Reiskosten rekenen we niet/);
  assert.match(t, /parkeerkosten zijn voor uw rekening/);
  assert.match(t, /extra arbeidskosten/);
  console.log(`     "${t}"`);
});

test('prijstekst buiten de regio noemt reiskosten', () => {
  const b = berekenService([{ code: 'kookplaat' }]);
  const z = zoneVoor('Den Haag');
  const t = serviceTekst(b, z, serviceReiskosten(z, reisRKM), 'Den Haag', 'Jos');
  assert.match(t, /Den Haag valt buiten de regio Rotterdam; daarvoor komt er € \d+ reiskosten bij/);
  console.log(`     "${t}"`);
});

if (fouten) {
  console.log(`\n${fouten} test(s) mislukt`);
  process.exit(1);
}
console.log('\nalle servicetests geslaagd');
