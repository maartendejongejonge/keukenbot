/**
 * Rekentest op de drie referentiekeukens die Maarten op 02-10-2026 goedkeurde.
 * Sinds 08-10-2026: hogere bouwpakketnormen (IKEA kwam te laag uit) en kitwerk.
 * Draaien: npm run build && node dist/prijs.test.js
 */
import { berekenPrijs, prijsTekst, type Uurnormen } from './prijs.js';

export const RKM_UURNORMEN: Uurnormen = {
  kast_bouwpakket: { onder: 1.5, hang: 1, hoog: 2.5 },
  kast_voorgemonteerd: { onder: 0.25, hang: 0.25, hoog: 0.5 },
  grens_kasten: 10,
  stellen_ophangen: { klein: 3, groot: 4 },
  fronten_plinten: { klein: 4, groot: 6 },
  opruimen: { klein: 1.5, groot: 2 },
  werkblad: 3,
  werkblad_hoek_extra: 1,
  kitwerk: 1,
  kitwerk_hoek_extra: 0.5,
  eiland_extra: 3,
  water_basis: 1.5,
  waterpunt: 0.75,
  apparaat: 0.75,
  kookplaat: 1,
  verdieping_zonder_lift: 0.5,
  uren_per_dag: 8,
  bandbreedte_pct: 10,
};

const reisRKM = {
  vertrekPc4: 3028, kmTarief: 0.35, uurtarief: 56, reisuurPercentage: 50,
  gratisPc4: [...Array.from({ length: 79 }, (_, i) => 3011 + i), 3151, 3181, ...Array.from({ length: 10 }, (_, i) => 3190 + i)],
};
const p = { uurtarief: 56, uurnormen: RKM_UURNORMEN, reis: reisRKM };

const gevallen = [
  {
    naam: 'Rechte IKEA 2,7 m, 8 kasten, 2e verd. zonder lift (ref 23 u, 3–4 d, € 1.290–1.420 excl.)',
    invoer: {
      werk: { levering: 'bouwpakket', onderkasten: 5, hangkasten: 3, opstelling: 'recht',
              waterpunten: ['spoelbak en kraan', 'vaatwasser'], apparaten: ['kookplaat', 'oven', 'afzuigkap'] },
      pc4: 3035, verdieping: 2, lift: false, werkblad_door: 'monteur', zakelijk: true,
    },
  },
  {
    naam: 'L-keuken 4,5 m + 3 hoge kasten, 17 kasten, Schiedam (ref 35,5 u, 5–6 d, € 2.090–2.300 excl.)',
    invoer: {
      werk: { levering: 'bouwpakket', onderkasten: 8, hangkasten: 6, hoge_kasten: 3, opstelling: 'hoek',
              waterpunten: ['spoelbak en kraan', 'vaatwasser'], apparaten: ['kookplaat', 'oven', 'magnetron', 'afzuigkap'] },
      pc4: 3112, verdieping: 0, werkblad_door: 'monteur', zakelijk: true,
    },
  },
  {
    naam: 'Showroomkeuken met eiland + leidingwerk (ref 40 u) — hoort naar de monteur te gaan',
    invoer: {
      werk: { levering: 'voorgemonteerd', onderkasten: 10, hangkasten: 4, hoge_kasten: 3, opstelling: 'eiland',
              waterpunten: ['spoelbak en kraan', 'vaatwasser', 'quooker'], apparaten: ['kookplaat', 'oven', 'combimagnetron', 'afzuigkap', 'koelkast'],
              zwaar_werkblad: true, overig: ['leidingwerk naar eiland', '3-fase kookgroep aanleggen'] },
      pc4: 3011, verdieping: 0, werkblad_door: 'monteur', zakelijk: true,
    },
  },
];

for (const g of gevallen) {
  const u = berekenPrijs(g.invoer as any, p);
  console.log(`\n== ${g.naam}`);
  if (u.soort === 'indicatie') {
    const x = u.indicatie;
    console.log(`${x.uren} u, € ${x.totaal_excl} excl. (reis € ${x.reiskosten}) → klant € ${x.min}–${x.max}, ${x.dagen_min}–${x.dagen_max} dagen`);
    console.log(prijsTekst(x));
  } else if (u.soort === 'monteur') {
    console.log(`naar monteur: ${u.reden}; basis ${u.basis?.uren} u, € ${u.basis?.totaal_excl}`);
  } else console.log(u);
}
