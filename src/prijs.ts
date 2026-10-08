/**
 * Prijsindicatie voor keukenmontage — rekent, verzint niets.
 *
 * Alleen actief voor een monteur die in zijn profiel `prijzen_tonen = true`,
 * een `uurtarief` en zijn eigen `uurnormen` heeft staan. Zonder die drie noemt
 * de bot geen bedrag en gaat een prijsvraag naar de monteur (zoals altijd).
 *
 * De klant ziet nooit uren of uurtarief. Hij krijgt:
 *   - een bandbreedte: ondergrens = berekende prijs afgerond op € 10,
 *     bovengrens = berekende prijs + 10 %, afgerond op € 10;
 *   - een doorlooptijd: uren / uren-per-dag naar boven afgerond, tot +1 dag;
 *   - een korte lijst van wat erin zit.
 *
 * Het taalmodel levert alleen de feiten (aantallen kasten, apparaten, ...).
 * Het rekenen gebeurt hier, zodat een bedrag altijd herleidbaar is.
 */

import { reis, type ReisProfiel } from './reiskosten.js';

// ------------------------------------------------------------------ invoer

/** Wat er aan de keuken moet gebeuren. Komt uit het gesprek of de onderdelenlijst. */
export interface Werk {
  levering?: 'bouwpakket' | 'voorgemonteerd';
  onderkasten?: number;
  hangkasten?: number;
  hoge_kasten?: number;
  opstelling?: 'recht' | 'hoek' | 'u' | 'eiland';
  /** spoelbak/kraan, vaatwasser, quooker — elk apart */
  waterpunten?: string[];
  /** kookplaat, oven, magnetron, afzuigkap, koelkast — elk apart */
  apparaten?: string[];
  /** keramisch of natuursteen, of anders te zwaar voor één man */
  zwaar_werkblad?: boolean;
  /**
   * Werk waar geen uurnorm voor bestaat (leidingwerk, kookgroep aanleggen,
   * demontage oude keuken, tegelwerk, ...). Staat hier iets in, dan rekent de
   * bot niet zelf en beslist de monteur.
   */
  overig?: string[];
}

/** Per monteur instelbaar. Startwaarden = Rotterdam Keukenmontage, okt 2026. */
export interface Uurnormen {
  kast_bouwpakket: { onder: number; hang: number; hoog: number };
  kast_voorgemonteerd: { onder: number; hang: number; hoog: number };
  /** grens tussen een kleine en een grote keuken, in aantal kasten */
  grens_kasten: number;
  stellen_ophangen: { klein: number; groot: number };
  fronten_plinten: { klein: number; groot: number };
  opruimen: { klein: number; groot: number };
  werkblad: number;
  werkblad_hoek_extra: number;
  /**
   * Afkitten van het aanrechtblad (aansluiting op de muur, spatrand,
   * spoelbak en kookplaat). Elk blad wordt afgekit, ook als de steenhouwer
   * het plaatst. Optioneel in oude profielen; dan gelden de standaardwaarden.
   */
  kitwerk?: number;
  kitwerk_hoek_extra?: number;
  eiland_extra: number;
  water_basis: number;
  waterpunt: number;
  apparaat: number;
  /** kookplaat aansluiten door de elektricien, incl. controle kookgroep */
  kookplaat: number;
  /** sjouwen per verdieping zonder lift */
  verdieping_zonder_lift: number;
  uren_per_dag: number;
  bandbreedte_pct: number;
}

export interface PrijsProfiel {
  uurtarief: number;
  uurnormen: Uurnormen;
  reis: ReisProfiel | null;
}

export interface PrijsInvoer {
  werk: Werk;
  pc4?: number;
  verdieping?: number;
  lift?: boolean;
  werkblad_door?: 'monteur' | 'steenhouwer' | 'klant';
  zakelijk?: boolean;
}

// ----------------------------------------------------------------- uitvoer

export interface Prijsindicatie {
  uren: number;
  arbeid: number;            // excl. btw
  reiskosten: number;        // excl. btw, alle dagen samen
  totaal_excl: number;
  min: number;               // wat de klant ziet (incl. of excl. btw)
  max: number;
  incl_btw: boolean;
  dagen_min: number;
  dagen_max: number;
  posten: string[];          // wat erin zit, voor de klant
  opbouw: string[];          // uren per onderdeel, alleen voor de monteur
}

export type PrijsUitkomst =
  | { soort: 'indicatie'; indicatie: Prijsindicatie }
  | { soort: 'onvolledig'; ontbreekt: string[] }
  | { soort: 'monteur'; reden: string; basis?: Prijsindicatie };

const BTW = 0.21;

/** Voor profielen die kitwerk nog niet in hun uurnormen hebben. */
export const STANDAARD_KITWERK = 1;
export const STANDAARD_KITWERK_HOEK = 0.5;

export function prijzenActief(p: {
  prijzen_tonen?: boolean | null;
  uurtarief?: number | string | null;
  uurnormen?: unknown;
}): boolean {
  return Boolean(p.prijzen_tonen && Number(p.uurtarief) > 0 && p.uurnormen);
}

/** Welke gegevens nog nodig zijn voordat er een bedrag uit kan. */
export function ontbrekendVoorPrijs(i: PrijsInvoer): string[] {
  const w = i.werk ?? {};
  const kasten = (w.onderkasten ?? 0) + (w.hangkasten ?? 0) + (w.hoge_kasten ?? 0);
  const mis: string[] = [];
  if (!w.levering) mis.push('bouwpakket of voorgemonteerd');
  if (kasten === 0) mis.push('aantal kasten');
  if (i.pc4 === undefined) mis.push('postcode');
  if (i.verdieping === undefined) mis.push('verdieping');
  if ((i.verdieping ?? 0) > 0 && i.lift === undefined) mis.push('lift');
  if (!i.werkblad_door) mis.push('wie het werkblad plaatst');
  return mis;
}

export function berekenPrijs(i: PrijsInvoer, p: PrijsProfiel): PrijsUitkomst {
  const mis = ontbrekendVoorPrijs(i);
  if (mis.length) return { soort: 'onvolledig', ontbreekt: mis };

  const n = p.uurnormen;
  const w = i.werk;
  const onder = w.onderkasten ?? 0;
  const hang = w.hangkasten ?? 0;
  const hoog = w.hoge_kasten ?? 0;
  const kasten = onder + hang + hoog;
  const groot = kasten > n.grens_kasten;

  const opbouw: [string, number][] = [];
  const kast = w.levering === 'bouwpakket' ? n.kast_bouwpakket : n.kast_voorgemonteerd;
  opbouw.push([
    `${kasten} kasten ${w.levering === 'bouwpakket' ? 'in elkaar zetten' : 'plaatsen'}`,
    onder * kast.onder + hang * kast.hang + hoog * kast.hoog,
  ]);
  opbouw.push(['stellen en ophangen', groot ? n.stellen_ophangen.groot : n.stellen_ophangen.klein]);
  if (w.opstelling === 'eiland') opbouw.push(['eiland', n.eiland_extra]);

  if (i.werkblad_door === 'monteur') {
    opbouw.push(['werkblad zagen en plaatsen', n.werkblad]);
    if (w.opstelling === 'hoek' || w.opstelling === 'u') {
      opbouw.push(['werkblad hoekverbinding', n.werkblad_hoek_extra]);
    }
  }

  // Elk aanrechtblad wordt afgekit (08-10-2026), ongeacht wie het plaatst.
  const hoekBlad = w.opstelling === 'hoek' || w.opstelling === 'u';
  opbouw.push([
    'werkblad afkitten',
    (n.kitwerk ?? STANDAARD_KITWERK) + (hoekBlad ? n.kitwerk_hoek_extra ?? STANDAARD_KITWERK_HOEK : 0),
  ]);

  opbouw.push(['fronten, lades en plinten', groot ? n.fronten_plinten.groot : n.fronten_plinten.klein]);

  const water = w.waterpunten ?? [];
  if (water.length) opbouw.push([`water: ${water.join(', ')}`, n.water_basis + water.length * n.waterpunt]);

  const apparaten = w.apparaten ?? [];
  const kookplaat = apparaten.some((a) => /kookplaat|inductie|fornuis/i.test(a));
  const overigeApparaten = apparaten.filter((a) => !/kookplaat|inductie|fornuis/i.test(a));
  if (overigeApparaten.length) {
    opbouw.push([`apparaten: ${overigeApparaten.join(', ')}`, overigeApparaten.length * n.apparaat]);
  }
  if (kookplaat) opbouw.push(['kookplaat aansluiten (elektricien)', n.kookplaat]);

  if ((i.verdieping ?? 0) > 0 && i.lift === false) {
    opbouw.push([`sjouwen naar ${i.verdieping}e verdieping`, i.verdieping! * n.verdieping_zonder_lift]);
  }
  opbouw.push(['opruimen', groot ? n.opruimen.groot : n.opruimen.klein]);

  const uren = rond1(opbouw.reduce((s, [, u]) => s + u, 0));
  const dagen_min = Math.ceil(uren / n.uren_per_dag);
  const dagen_max = dagen_min + 1;

  const arbeid = uren * p.uurtarief;
  const reiskosten = p.reis && i.pc4 !== undefined ? reis(i.pc4, p.reis).totaal * dagen_min : 0;
  const totaal_excl = arbeid + reiskosten;

  const incl_btw = !i.zakelijk;
  const basis = incl_btw ? totaal_excl * (1 + BTW) : totaal_excl;
  const min = rondTien(basis);
  const max = rondTien(basis * (1 + n.bandbreedte_pct / 100));

  const posten = [
    `${kasten} kasten ${w.levering === 'bouwpakket' ? 'in elkaar zetten, ' : ''}stellen en ophangen`,
    i.werkblad_door === 'monteur' ? 'werkblad op maat zagen en plaatsen' : null,
    'werkblad, spatrand en aansluitingen afkitten',
    'fronten, lades en plinten afmonteren',
    water.length ? `aansluiten van ${water.join(', ')}` : null,
    overigeApparaten.length ? `inbouwen van ${overigeApparaten.join(', ')}` : null,
    kookplaat ? 'Kookplaat aansluiten door gecertificeerd elektricien, inclusief controle van de kookgroep' : null,
    'opruimen en afval netjes achterlaten',
  ].filter((r): r is string => r !== null);

  const indicatie: Prijsindicatie = {
    uren,
    arbeid: rond2(arbeid),
    reiskosten: rond2(reiskosten),
    totaal_excl: rond2(totaal_excl),
    min,
    max,
    incl_btw,
    dagen_min,
    dagen_max,
    posten,
    opbouw: opbouw.map(([t, u]) => `${t}: ${rond1(u)} u`),
  };

  // Werk zonder uurnorm: wel uitrekenen wat we kunnen, maar de monteur beslist.
  const overig = (w.overig ?? []).filter((o) => o.trim());
  if (overig.length) {
    return { soort: 'monteur', reden: `niet in de uurnormen: ${overig.join(', ')}`, basis: indicatie };
  }

  return { soort: 'indicatie', indicatie };
}

// ------------------------------------------------------------ voor de klant

const euro = (n: number) => `€ ${n.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`;

/** Het bericht met de prijs. Vaste tekst, zodat het model er niet aan kan schuiven. */
export function prijsTekst(x: Prijsindicatie): string {
  const btw = x.incl_btw ? 'inclusief btw' : 'exclusief btw';
  return [
    `Voor de montage komt het uit tussen ${euro(x.min)} en ${euro(x.max)}, ${btw}. ` +
      `Reken op ${x.dagen_min} tot ${x.dagen_max} werkdagen.`,
    '',
    'Daarin zit:',
    ...x.posten.map((p) => `- ${p}`),
    '',
    'De vaste prijs staat in de offerte.',
  ].join('\n');
}

/** Voor de monteur: hoe het bedrag is opgebouwd. */
export function prijsOpbouw(x: Prijsindicatie, uurtarief: number): string {
  return [
    `Prijsindicatie: ${euro(x.min)} – ${euro(x.max)} ${x.incl_btw ? 'incl.' : 'excl.'} btw, ${x.dagen_min}–${x.dagen_max} dagen`,
    ...x.opbouw.map((r) => `  ${r}`),
    `  totaal ${x.uren} u × € ${uurtarief} = € ${x.arbeid.toFixed(2)}`,
    x.reiskosten ? `  reiskosten € ${x.reiskosten.toFixed(2)}` : '  geen reiskosten',
    `  excl. btw € ${x.totaal_excl.toFixed(2)}`,
  ].join('\n');
}

// ----------------------------------------------------------------- hulpjes

function rondTien(n: number): number {
  return Math.round(n / 10) * 10;
}
function rond1(n: number): number {
  return Math.round(n * 10) / 10;
}
function rond2(n: number): number {
  return Math.round(n * 100) / 100;
}
