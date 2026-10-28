/**
 * Serviceklussen — werk aan één of meer onderdelen van een bestaande keuken
 * (vaatwasser inbouwen, werkblad vervangen, deurtjes afstellen …).
 *
 * Besloten met Maarten op 28-10-2026 (zie claude/kleine-opdrachten.md):
 *   - Vraagt de klant of de monteur DE KEUKEN kan monteren: keukenmontage.
 *     Gaat het om één of meer onderdelen: serviceklus. Een serviceklus wordt
 *     nooit vanzelf een keukenmontage, hoeveel onderdelen het ook zijn.
 *   - Kort bespreken, snel inplannen: alleen wat, woonplaats en wanneer.
 *     Geen foto, verdieping, lift of leverdatum. Het adres komt pas als de
 *     klant de klus accepteert.
 *   - Prijs = vaste arbeidsprijs per onderdeel (hoge kant van de markt,
 *     incl. btw, excl. materiaal), reiskosten gratis in de regio, extra
 *     arbeidskosten mogelijk bij meer werk, parkeerkosten voor de klant.
 *   - Zwaar werkblad (steen, composiet, keramiek) en werk zonder staffelprijs
 *     gaan naar de monteur.
 *
 * Het model kiest alleen codes uit de staffel en neemt de plaatsnaam over.
 * Bedragen, duur en de regio bepaalt deze module.
 */

import { reis, type ReisProfiel } from './reiskosten.js';

// ------------------------------------------------------------------ staffel

export interface ServiceOnderdeel {
  omschrijving: string;      // zoals de klant het leest
  prijs: number;             // incl. btw, alleen arbeid
  duurMin: number;           // voor de planning
  /** prijs en duur gelden per stuk (aantal) */
  perStuk?: boolean;
  /** bij perStuk: minimaal dit bedrag */
  minimum?: number;
  /** prijs geldt per blok van zoveel stuks (afstellen, scharnieren) */
  blok?: number;
}

/** Goedgekeurd door Maarten op 28-10-2026. Bronnen: claude/kleine-opdrachten.md. */
export const STAFFEL = {
  vaatwasser_inbouwen: { omschrijving: 'vaatwasser inbouwen en aansluiten', prijs: 225, duurMin: 120 },
  vaatwasser_verwijderen: { omschrijving: 'oude vaatwasser verwijderen', prijs: 125, duurMin: 30 },
  afzuigkap: { omschrijving: 'afzuigkap ophangen en aansluiten', prijs: 195, duurMin: 120 },
  kraan: { omschrijving: 'keukenkraan vervangen', prijs: 129, duurMin: 60 },
  kokendwaterkraan: { omschrijving: 'kokendwaterkraan plaatsen', prijs: 225, duurMin: 120 },
  kookplaat: { omschrijving: 'kookplaat inbouwen en aansluiten', prijs: 149, duurMin: 90 },
  kookgroep: { omschrijving: 'kookgroep aanleggen vanaf de meterkast', prijs: 349, duurMin: 180 },
  uitsparing: { omschrijving: 'uitsparing frezen in het werkblad', prijs: 75, duurMin: 30, perStuk: true },
  werkblad: {
    omschrijving: 'werkblad vervangen (tot 3 meter, met uitsparingen, oud blad eraf, spoelbak, kraan en kookplaat weer aansluiten, afkitten)',
    prijs: 595,
    duurMin: 300,
  },
  werkblad_extra: { omschrijving: 'extra meter of hoekverbinding werkblad', prijs: 95, duurMin: 60, perStuk: true },
  oven: { omschrijving: 'oven inbouwen', prijs: 125, duurMin: 60, perStuk: true },
  magnetron: { omschrijving: 'magnetron of combi-oven inbouwen', prijs: 125, duurMin: 60, perStuk: true },
  koelkast: { omschrijving: 'inbouwkoelkast plaatsen (met front)', prijs: 175, duurMin: 105, perStuk: true },
  afstellen: { omschrijving: 'deurtjes en lades afstellen', prijs: 95, duurMin: 60, blok: 10 },
  scharnieren: { omschrijving: 'scharnieren of ladegeleiders vervangen', prijs: 95, duurMin: 60, blok: 5 },
  front: { omschrijving: 'fronten vervangen', prijs: 25, duurMin: 15, perStuk: true, minimum: 95 },
  plinten: { omschrijving: 'plinten plaatsen of vervangen', prijs: 95, duurMin: 60 },
} satisfies Record<string, ServiceOnderdeel>;

export type ServiceCode = keyof typeof STAFFEL;

export function isServiceCode(c: unknown): c is ServiceCode {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(STAFFEL, c);
}

/** Wat het model per onderdeel teruggeeft. */
export interface ServiceRegel {
  code: string;
  aantal?: number;
}

export interface ServiceBerekening {
  regels: { code: ServiceCode; omschrijving: string; aantal: number; bedrag: number }[];
  arbeid: number;      // incl. btw
  duurMin: number;
  /** codes die niet in de staffel staan (genegeerd in het bedrag) */
  onbekend: string[];
}

/** Dubbele codes samenvoegen (aantallen optellen), onbekende apart houden. */
export function normaliseer(regels: ServiceRegel[] | undefined): ServiceRegel[] {
  const per = new Map<string, number>();
  for (const r of regels ?? []) {
    const code = String(r?.code ?? '').trim().toLowerCase();
    if (!code) continue;
    const n = Math.max(1, Math.round(Number(r.aantal) || 1));
    per.set(code, (per.get(code) ?? 0) + n);
  }
  return [...per].map(([code, aantal]) => ({ code, aantal }));
}

export function berekenService(regels: ServiceRegel[] | undefined): ServiceBerekening {
  const lijst = normaliseer(regels);
  const codes = new Set(lijst.map((r) => r.code));
  const uit: ServiceBerekening = { regels: [], arbeid: 0, duurMin: 0, onbekend: [] };

  for (const r of lijst) {
    if (!isServiceCode(r.code)) {
      uit.onbekend.push(r.code);
      continue;
    }
    const o: ServiceOnderdeel = STAFFEL[r.code];
    const aantal = r.aantal ?? 1;
    let bedrag: number;
    let duur: number;

    if (o.blok) {
      const blokken = Math.ceil(aantal / o.blok);
      bedrag = blokken * o.prijs;
      duur = blokken * o.duurMin;
    } else if (o.perStuk) {
      bedrag = Math.max(o.minimum ?? 0, aantal * o.prijs);
      duur = aantal * o.duurMin;
    } else {
      bedrag = o.prijs;
      duur = o.duurMin;
    }

    // Oude vaatwasser eruit bij het inbouwen van een nieuwe: € 60 in plaats van € 125.
    if (r.code === 'vaatwasser_verwijderen' && codes.has('vaatwasser_inbouwen')) bedrag = 60;

    uit.regels.push({ code: r.code, omschrijving: o.omschrijving, aantal, bedrag });
    uit.arbeid += bedrag;
    uit.duurMin += duur;
  }
  return uit;
}

/** Voor in de prompt: welke codes het model mag gebruiken. */
export function staffelVoorPrompt(): string {
  return (Object.entries(STAFFEL) as [ServiceCode, ServiceOnderdeel][])
    .map(([code, o]) => `  ${code}: ${o.omschrijving}${o.perStuk || o.blok ? ' (met "aantal")' : ''}`)
    .join('\n');
}

// ------------------------------------------------------------------ regio

export type ZoneStatus = 'gratis' | 'betaald' | 'onbekend';

export interface Zone {
  /** hoe de regio tegen de klant heet */
  naam: string;
  /** gemeenten waar geen reiskosten gelden */
  gratis: string[];
  /** gemeenten die beoordeeld zijn en wél reiskosten hebben */
  betaald: string[];
  /** woonplaats of wijk (genormaliseerd) → [gemeente, pc4 voor de reiskosten] */
  plaatsen: Record<string, [string, number]>;
}

/**
 * Rotterdam Keukenmontage, vastgesteld 28-10-2026. Regel voor een nieuwe
 * gemeente: eenmalig de rijtijd vanaf Rotterdam Centrum opzoeken met een
 * routeplanner (zonder file); ≤ 30 min = gratis. Nooit tijdens een gesprek.
 */
export const ZONE_ROTTERDAM: Zone = {
  naam: 'de regio Rotterdam',
  gratis: [
    'Rotterdam', 'Schiedam', 'Vlaardingen', 'Maassluis', 'Capelle aan den IJssel',
    'Krimpen aan den IJssel', 'Zuidplas', 'Lansingerland', 'Barendrecht', 'Ridderkerk',
    'Albrandswaard', 'Nissewaard', 'Hendrik-Ido-Ambacht', 'Zwijndrecht', 'Papendrecht',
    'Alblasserdam', 'Dordrecht', 'Delft', 'Pijnacker-Nootdorp', 'Midden-Delfland',
    'Westland', 'Voorne aan Zee', 'Zoetermeer',
  ],
  betaald: ['Den Haag', 'Gouda'],
  plaatsen: plaatsTabel({
    Rotterdam: [3011, [
      'rotterdam', 'hoogvliet', 'pernis', 'rozenburg', 'hoek van holland', 'heijplaat',
      // wijken en deelgemeenten die klanten als woonplaats noemen
      'kralingen', 'crooswijk', 'ijsselmonde', 'feijenoord', 'charlois', 'delfshaven',
      'overschie', 'hillegersberg', 'schiebroek', 'prins alexander', 'ommoord', 'nesselande',
      'zevenkamp', 'lombardijen', 'pendrecht', 'zuidwijk', 'blijdorp', 'katendrecht',
      'kop van zuid', 'afrikaanderwijk', 'bloemhof', 'hillesluis', 'carnisse', 'tarwewijk',
      'spangen', 'bospolder', 'tussendijken', 'middelland', 'nieuwe westen', 'oude westen',
      'liskwartier', 'bergpolder', 'agniesebuurt', 'provenierswijk', 'het lage land',
      'kralingse veer', 'beverwaard', 'groot ijsselmonde', 'vreewijk', 'terbregge',
      'molenlaankwartier', 'wielewaal', 'zuidplein', 'rotterdam zuid', 'rotterdam noord',
      'rotterdam west', 'rotterdam oost', 'rotterdam centrum', 'kralingen crooswijk',
      'oud ijsselmonde', 'oud charlois', 'stadsdriehoek', 'het oude noorden',
    ]],
    Schiedam: [3111, ['schiedam']],
    Vlaardingen: [3131, ['vlaardingen']],
    Maassluis: [3141, ['maassluis']],
    'Capelle aan den IJssel': [2901, ['capelle aan den ijssel', 'capelle', 'capelle a/d ijssel', 'capelle ad ijssel']],
    'Krimpen aan den IJssel': [2921, ['krimpen aan den ijssel', 'krimpen', 'krimpen a/d ijssel']],
    Zuidplas: [2911, ['nieuwerkerk aan den ijssel', 'nieuwerkerk', 'moordrecht', 'zevenhuizen', 'moerkapelle']],
    Lansingerland: [2661, ['bergschenhoek', 'berkel en rodenrijs', 'berkel', 'bleiswijk']],
    Barendrecht: [2991, ['barendrecht', 'carnisselande']],
    Ridderkerk: [2981, ['ridderkerk', 'bolnes', 'slikkerveer', 'rijsoord']],
    Albrandswaard: [3161, ['rhoon', 'poortugaal', 'portland']],
    Nissewaard: [3201, ['spijkenisse', 'hekelingen', 'zuidland', 'simonshaven', 'geervliet', 'heenvliet', 'abbenbroek']],
    'Hendrik-Ido-Ambacht': [3341, ['hendrik ido ambacht', 'ambacht', 'h i ambacht']],
    Zwijndrecht: [3331, ['zwijndrecht', 'heerjansdam']],
    Papendrecht: [3351, ['papendrecht']],
    Alblasserdam: [2951, ['alblasserdam']],
    Dordrecht: [3311, ['dordrecht', 'dordt']],
    Delft: [2611, ['delft']],
    'Pijnacker-Nootdorp': [2641, ['pijnacker', 'nootdorp', 'delfgauw']],
    'Midden-Delfland': [2635, ['maasland', 'schipluiden', 'den hoorn']],
    Westland: [2671, [
      'naaldwijk', 'wateringen', 'monster', 's gravenzande', 'gravenzande', 'de lier', 'poeldijk',
      'honselersdijk', 'maasdijk', 'kwintsheul', 'ter heijde', 'heenweg', 'westland',
    ]],
    'Voorne aan Zee': [3231, [
      'brielle', 'den briel', 'hellevoetsluis', 'rockanje', 'oostvoorne', 'tinte', 'zwartewaal',
      'vierpolders', 'nieuwenhoorn', 'oudenhoorn', 'voorne aan zee',
    ]],
    Zoetermeer: [2711, ['zoetermeer']],
    'Den Haag': [2511, ['den haag', 's gravenhage', 'gravenhage', 'scheveningen', 'loosduinen', 'ypenburg', 'leidschenveen']],
    Gouda: [2801, ['gouda']],
  }),
};

function plaatsTabel(def: Record<string, [number, string[]]>): Zone['plaatsen'] {
  const uit: Zone['plaatsen'] = {};
  for (const [gemeente, [pc4, namen]] of Object.entries(def)) {
    for (const n of namen) uit[normaliseerPlaats(n)] = [gemeente, pc4];
  }
  return uit;
}

/** kleine letters, zonder accenten, leestekens en dubbele spaties */
export function normaliseerPlaats(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function afstandTekst(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export interface ZoneUitkomst {
  status: ZoneStatus;
  gemeente?: string;
  pc4?: number;
}

/**
 * Welke regio hoort bij wat de klant als plaats noemt? Eerst exact, dan
 * een bekende naam in de tekst ("Rotterdam-Zuid", "in Kralingen"), dan met
 * een tikfout ("Spijkernisse"). Niets gevonden = onbekend.
 */
export function zoneVoor(plaats: string | undefined, zone: Zone = ZONE_ROTTERDAM): ZoneUitkomst {
  if (!plaats?.trim()) return { status: 'onbekend' };
  const p = normaliseerPlaats(plaats);
  const namen = Object.keys(zone.plaatsen);

  let gevonden: string | undefined = zone.plaatsen[p] ? p : undefined;

  if (!gevonden) {
    gevonden = namen
      .filter((n) => n.length >= 4 && ` ${p} `.includes(` ${n} `))
      .sort((a, b) => b.length - a.length)[0];
  }

  if (!gevonden) {
    let beste: { n: string; d: number } | undefined;
    for (const n of namen) {
      if (n.length < 5) continue;
      const max = n.length >= 9 ? 2 : 1;
      const d = afstandTekst(p, n);
      if (d <= max && (!beste || d < beste.d)) beste = { n, d };
    }
    gevonden = beste?.n;
  }

  if (!gevonden) return { status: 'onbekend' };
  const [gemeente, pc4] = zone.plaatsen[gevonden];
  if (zone.gratis.includes(gemeente)) return { status: 'gratis', gemeente, pc4 };
  if (zone.betaald.includes(gemeente)) return { status: 'betaald', gemeente, pc4 };
  return { status: 'onbekend', gemeente, pc4 };
}

/** Reiskosten incl. btw voor één bezoek (heen en terug), op hele euro's. */
export function serviceReiskosten(z: ZoneUitkomst, reisProfiel: ReisProfiel | null): number | null {
  if (z.status === 'gratis') return 0;
  if (z.status !== 'betaald' || !z.pc4 || !reisProfiel) return null;
  return Math.round(reis(z.pc4, { ...reisProfiel, gratisPc4: [] }).totaal * 1.21);
}

// ------------------------------------------------------------------ tekst

function euro(n: number): string {
  return `€ ${Math.round(n).toLocaleString('nl-NL')}`;
}

/**
 * Het prijsbericht voor de klant. Altijd: arbeidskosten, reiskosten,
 * parkeerkosten, extra arbeid bij meer werk. Het model schrijft dit nooit.
 */
export function serviceTekst(
  b: ServiceBerekening,
  z: ZoneUitkomst,
  reiskosten: number | null,
  plaats: string | undefined,
  naam: string,
  zone: Zone = ZONE_ROTTERDAM,
): string {
  const label = (r: ServiceBerekening['regels'][number]) =>
    (STAFFEL[r.code] as ServiceOnderdeel).perStuk && r.aantal > 1 ? `${r.omschrijving} (${r.aantal}×)` : r.omschrijving;
  const zinnen =
    b.regels.length === 1
      ? [`De arbeidskosten voor ${label(b.regels[0])} zijn ${euro(b.arbeid)} inclusief btw, exclusief materiaal.`]
      : [
          `De arbeidskosten zijn ${euro(b.arbeid)} inclusief btw, exclusief materiaal:\n` +
            b.regels.map((r) => `- ${label(r)}: ${euro(r.bedrag)}`).join('\n') +
            '\n',
        ];

  if (z.status === 'gratis') {
    zinnen.push(`Reiskosten rekenen we niet in ${zone.naam}; eventuele parkeerkosten zijn voor uw rekening.`);
  } else if (reiskosten !== null && z.status === 'betaald') {
    zinnen.push(
      `${plaats?.trim() ? hoofdletter(plaats.trim()) : 'Uw plaats'} valt buiten ${zone.naam}; daarvoor komt er ${euro(reiskosten)} reiskosten bij. Eventuele parkeerkosten zijn voor uw rekening.`,
    );
  } else {
    zinnen.push(
      `In ${zone.naam} rekenen we geen reiskosten; of dat voor uw adres geldt, laat ${naam} u weten. Eventuele parkeerkosten zijn voor uw rekening.`,
    );
  }

  zinnen.push('Blijkt er ter plekke meer werk nodig dan nu aangegeven, dan kunnen er extra arbeidskosten bij komen.');
  return zinnen.join(' ').replace(/\n /g, '\n');
}

function hoofdletter(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
