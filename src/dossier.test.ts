/**
 * Dossier voor de monteur bij overdracht/inplanning.
 * Draaien: npm run build && node dist/dossier.test.js
 */
import assert from 'node:assert/strict';
import { aanleidingUit, bijschrift, maakDossier } from './dossier.js';

const bestanden: any[] = [
  { id: '1', soort: 'afbeelding', mime: 'image/jpeg', naam: 'foto-1.jpg', op: '2026-10-20T11:12:00Z', verstuurd: false },
  { id: '2', soort: 'afbeelding', mime: 'image/jpeg', naam: 'foto-2.jpg', op: '2026-10-20T11:12:05Z', verstuurd: false },
  { id: '3', soort: 'document', mime: 'application/pdf', naam: 'IKEA-bestelling.pdf', op: '2026-10-20T11:13:00Z', verstuurd: true },
];

const service = maakDossier({
  kop: 'Overdracht — valt buiten de regels van de bot',
  lead: {
    klant_naam: 'Moenier', klant_telefoon: '31611421109', type_klus: 'service', plaats: 'Spijkenisse',
    werk: { _service: [{ code: 'werkblad', aantal: 1 }, { code: 'werkblad_extra', aantal: 1 }] },
  },
  aanleiding: aanleidingUit('Zwaar werkblad (steen/composiet/keramiek): afstemmen met klant en steenhouwer. Reden: zwaar werkblad. Bekend: x. Laatste bericht: "y"'),
  laatsteKlantbericht: 'Het wordt een composiet blad van 3,40 m',
  samenvatting: '- Wil een nieuw composiet werkblad, 3,40 m, één hoek\n- Steenhouwer nog niet gekozen',
  extra: ['De bot antwoordt deze klant niet meer; reageer zelf vanaf het botnummer.'],
  bestanden, nieuweBestanden: 2,
});
console.log(service + '\n\n----\n');
assert.match(service, /^Overdracht — /);
assert.match(service, /Klant: Moenier, 31611421109/);
assert.match(service, /Klus: serviceklus/);
assert.match(service, /Spijkenisse \(reis gratis\)/);
assert.match(service, /werkblad vervangen .*: € 595/);
assert.match(service, /arbeid € 690 incl\. btw/);
assert.match(service, /Waarom bij jou: Zwaar werkblad \(steen\/composiet\/keramiek\): afstemmen met klant en steenhouwer\.$/m);
assert.doesNotMatch(service, /Reden: zwaar/);
assert.match(service, /Bijlagen: 2 foto's, 1 document — hieronder \(1 had je al eerder gekregen\)\./);

const montage = maakDossier({
  kop: 'Ingepland en aan jou overgedragen — montage ma 2 nov',
  lead: {
    klant_telefoon: '31611344774', type_klus: 'montage', plaats: 'Bleiswijk', pc4: 2665, verdieping: 0,
    leverancier: 'IKEA', keuken_geleverd: true, werkblad_door: 'monteur',
    werk: { levering: 'bouwpakket', onderkasten: 4, hangkasten: 2, waterpunten: ['spoelbak en kraan', 'vaatwasser'], apparaten: ['oven', 'afzuigkap'] },
    prijs_min: 1790, prijs_max: 1970, prijs_incl_btw: true, dagen_min: 3, dagen_max: 4,
  },
  bestanden: [], nieuweBestanden: 0,
});
console.log(montage);
assert.match(montage, /6 kasten \(4 onder, 2 hang\), bouwpakket/);
assert.match(montage, /Indicatie gegeven: € 1\.790–€ 1\.970 incl\. btw, 3–4 dagen/);
assert.match(montage, /begane grond/);
assert.match(montage, /geen foto's of bestanden/);

assert.match(bijschrift(bestanden[0], 0, 2, 'Moenier'), /^1\/2 van Moenier — foto-1\.jpg \(20 okt/);
console.log('\nalle dossiertests geslaagd');
