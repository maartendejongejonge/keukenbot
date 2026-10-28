/**
 * Serviceklus door de orchestrator, met een nep-model (geen API-aanroep).
 * Draaien: npm run build && node dist/serviceflow.test.js
 */
import assert from 'node:assert/strict';
import { verwerkBericht, type LeadContext } from './orchestrator.js';
import { RKM_UURNORMEN } from './prijs.test.js';

const profiel: any = {
  werkgebied_pc4: [], max_reistijd_min: 90, weigert: [], toon: 'zakelijk', inmeting_duur_min: 90,
  montage_duur_dagdelen: 6, aanspreeknaam: 'Jos', bedrijfsnaam: 'Rotterdam Keukenmontage',
  klusjes: { uurtarief: 95, minimum_uren: 2 },
  werkdagen: [1, 2, 3, 4, 5], werkdag_start: '07:30', werkdag_eind: '17:00', buffer_dagdelen: 0,
};
const prijsProfiel = {
  uurtarief: 56, uurnormen: RKM_UURNORMEN,
  reis: { vertrekPc4: 3028, kmTarief: 0.35, uurtarief: 56, reisuurPercentage: 50, gratisPc4: [] },
};

function ctx(k: any = {}): LeadContext {
  return { kwalificatie: k, vervolgvragen: 0, historie: [] };
}
function deps(velden: any, antwoord = 'Duidelijk.') {
  return {
    duidBericht: async () => ({ velden, antwoord, confidence: 0.9, signaal: null }),
    bezetting: async () => [],
  };
}

let fouten = 0;
async function test(naam: string, f: () => Promise<void>) {
  try { await f(); console.log(`ok   ${naam}`); }
  catch (e) { fouten++; console.log(`FOUT ${naam}\n     ${(e as Error).message}`); }
}

await test('alleen wat bekend: vraagt de plaats, geen verdieping', async () => {
  const b = await verwerkBericht('Kunt u een vaatwasser inbouwen?', ctx(),
    profiel, deps({ type_klus: 'service', service: [{ code: 'vaatwasser_inbouwen' }] }, 'In welke plaats is het?'), prijsProfiel);
  assert.equal(b.soort, 'antwoord');
  assert.doesNotMatch((b as any).tekst, /verdieping|€/);
});

await test('wat + plaats: prijs en momenten in één bericht', async () => {
  const b: any = await verwerkBericht('Spijkenisse', ctx({ type_klus: 'service', service: [{ code: 'vaatwasser_inbouwen', aantal: 1 }] }),
    profiel, deps({ plaats: 'Spijkenisse' }), prijsProfiel);
  assert.equal(b.soort, 'voorstel');
  assert.match(b.tekst, /€ 225/);
  assert.match(b.tekst, /Reiskosten rekenen we niet/);
  assert.equal(b.slots[0].soort, 'klusje');
  assert.equal((+b.slots[0].eind - +b.slots[0].start) / 60000, 120);
  console.log('     ' + b.tekst.replace(/\n/g, '\n     '));
});

await test('oud type reparatie wordt service', async () => {
  const b: any = await verwerkBericht('Delft', ctx({ type_klus: 'reparatie', service: [{ code: 'afstellen', aantal: 6 }] }),
    profiel, deps({ plaats: 'Delft' }), prijsProfiel);
  assert.equal(b.soort, 'voorstel');
  assert.equal(b.kwalificatie.type_klus, 'service');
});

await test('zwaar blad: naar Jos', async () => {
  const b: any = await verwerkBericht('Composiet blad', ctx(),
    profiel, deps({ type_klus: 'service', service: [{ code: 'werkblad' }], zwaar_blad: true }), prijsProfiel);
  assert.equal(b.soort, 'overdracht');
  assert.match(b.klanttekst, /steenhouwer/);
});

await test('werk zonder staffelprijs: naar Jos', async () => {
  const b: any = await verwerkBericht('Spatwand tegelen', ctx(),
    profiel, deps({ type_klus: 'service', onbekend_werk: 'spatwand tegelen' }), prijsProfiel);
  assert.equal(b.soort, 'overdracht');
  assert.equal(b.reden, 'prijsvraag');
});

await test('onbekende plaats: seintje regio', async () => {
  const b: any = await verwerkBericht('Utrecht', ctx({ type_klus: 'service', service: [{ code: 'kraan' }] }),
    profiel, deps({ plaats: 'Utrecht' }), prijsProfiel);
  assert.equal(b.soort, 'voorstel');
  assert.ok(b.signalen.includes('regio'));
});

await test('klusje buiten de keuken: naar Jos', async () => {
  const b: any = await verwerkBericht('Lamp ophangen', ctx(), profiel, deps({ type_klus: 'klusje', klusjes: 'lamp' }), prijsProfiel);
  assert.equal(b.soort, 'overdracht');
});

await test('aantal bijwerken, niet verdubbelen', async () => {
  const b: any = await verwerkBericht('Toch 10 fronten', ctx({ type_klus: 'service', service: [{ code: 'front', aantal: 4 }] }),
    profiel, deps({ service: [{ code: 'front', aantal: 10 }], plaats: 'Rotterdam' }), prijsProfiel);
  assert.deepEqual(b.kwalificatie.service, [{ code: 'front', aantal: 10 }]);
  assert.match(b.tekst, /€ 250/);
});

if (fouten) { console.log(`\n${fouten} mislukt`); process.exit(1); }
console.log('\nalle serviceflow-tests geslaagd');
