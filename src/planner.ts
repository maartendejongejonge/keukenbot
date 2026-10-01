/**
 * De agenda is geen lijst met vrije uren maar een set regels.
 * Deze module is bewust puur: erin gaan bestaande afspraken en het profiel,
 * eruit komen voorstelbare slots. Google Agenda zit in agenda.ts.
 *
 * Let op het verschil tussen de twee soorten:
 *   inmeting  — een gat van anderhalf uur binnen één werkdag
 *   montage   — een aaneengesloten reeks hele werkdagen (standaard 3)
 * Die twee vragen een compleet andere zoektocht.
 */

import { rijtijdTussen } from './reiskosten.js';

export interface Bezetting {
  start: Date;
  eind: Date;
  pc4?: number;
}

export interface PlannerProfiel {
  werkdagen: number[];        // 1 = maandag ... 7 = zondag
  werkdag_start: string;      // '07:30'
  werkdag_eind: string;       // '17:00'
  buffer_dagdelen: number;    // per week vrijhouden voor uitloop
  inmeting_duur_min: number;
  montage_duur_dagdelen: number;
  max_reistijd_min: number;
  hersteldag_na_meerdaagse?: boolean; // dag na een meerdaagse klus vrijhouden
}

export interface Slot {
  start: Date;
  eind: Date;
  soort: 'inmeting' | 'montage';
  dagen?: number;             // alleen bij montage: aantal werkdagen
}

const MS_MIN = 60_000;
const DAGDEEL_MIN = 4 * 60;
const DAGDELEN_PER_DAG = 2;

function metTijd(dag: Date, hhmm: string): Date {
  const [u, m] = hhmm.split(':').map(Number);
  const d = new Date(dag);
  d.setHours(u, m, 0, 0);
  return d;
}

function isoWeekdag(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}

function weeksleutel(d: Date): string {
  const t = new Date(d);
  t.setDate(t.getDate() - (isoWeekdag(t) - 1));
  return t.toISOString().slice(0, 10);
}

/**
 * Rijtijd tussen twee klussen, via de postcodemiddelpunten in reiskosten.ts.
 * Eén bron voor afstand, zodat planning en offerte niet uiteenlopen.
 */
export function reistijdMin(vanPc4?: number, naarPc4?: number): number {
  return rijtijdTussen(vanPc4, naarPc4);
}

interface Zoekopdracht {
  vanaf: Date;
  dagen: number;
  soort: 'inmeting' | 'montage';
  profiel: PlannerProfiel;
  bezet: Bezetting[];
  klantPc4?: number;
  aantal?: number;
}

export function vrijeSlots(opts: Zoekopdracht): Slot[] {
  return opts.soort === 'montage' ? montageBlokken(opts) : inmetingSlots(opts);
}

// ------------------------------------------------------------- weekbuffer

function weekbezetting(bezet: Bezetting[]): Map<string, number> {
  const per = new Map<string, number>();
  for (const b of bezet) {
    const k = weeksleutel(b.start);
    const dagdelen = Math.ceil((+b.eind - +b.start) / MS_MIN / DAGDEEL_MIN);
    per.set(k, (per.get(k) ?? 0) + dagdelen);
  }
  return per;
}

function pastBinnenBuffer(
  dag: Date,
  dagdelen: number,
  profiel: PlannerProfiel,
  perWeek: Map<string, number>,
): boolean {
  const week = weeksleutel(dag);
  const max = profiel.werkdagen.length * DAGDELEN_PER_DAG - profiel.buffer_dagdelen;
  return (perWeek.get(week) ?? 0) + dagdelen <= max;
}

// --------------------------------------------------------------- inmeting

function inmetingSlots(opts: Zoekopdracht): Slot[] {
  const { vanaf, dagen, profiel, bezet, klantPc4 } = opts;
  const aantal = opts.aantal ?? 3;
  const duurMin = profiel.inmeting_duur_min;
  const perWeek = weekbezetting(bezet);

  const gevonden: Slot[] = [];
  const dag = new Date(vanaf);
  dag.setHours(0, 0, 0, 0);

  for (let i = 0; i < dagen && gevonden.length < aantal; i++, dag.setDate(dag.getDate() + 1)) {
    if (!profiel.werkdagen.includes(isoWeekdag(dag))) continue;
    if (!pastBinnenBuffer(dag, 1, profiel, perWeek)) continue;

    const dagStart = metTijd(dag, profiel.werkdag_start);
    const dagEind = metTijd(dag, profiel.werkdag_eind);
    if (dagEind <= vanaf) continue;

    const vandaagBezet = bezet
      .filter((b) => b.start < dagEind && b.eind > dagStart)
      .sort((a, b) => +a.start - +b.start);

    let cursor = new Date(Math.max(+dagStart, +vanaf));

    for (let j = 0; j <= vandaagBezet.length; j++) {
      const volgende = vandaagBezet[j];
      const vorige = vandaagBezet[j - 1];
      const grens = volgende ? volgende.start : dagEind;

      const naVorige = vorige ? reistijdMin(vorige.pc4, klantPc4) : 0;
      const voorVolgende = volgende ? reistijdMin(klantPc4, volgende.pc4) : 0;

      if (naVorige > profiel.max_reistijd_min || voorVolgende > profiel.max_reistijd_min) {
        if (volgende) cursor = new Date(+volgende.eind);
        continue;
      }

      const start = new Date(+cursor + naVorige * MS_MIN);
      const eind = new Date(+start + duurMin * MS_MIN);

      if (eind <= new Date(+grens - voorVolgende * MS_MIN)) {
        gevonden.push({ start, eind, soort: 'inmeting' });
        // Eén voorstel per dag: drie opties op drie dagen leest prettiger
        // dan drie opties op één ochtend.
        break;
      }

      if (volgende) cursor = new Date(+volgende.eind);
    }
  }

  return gevonden.slice(0, aantal);
}

// ---------------------------------------------------------------- montage

/**
 * Een montage van 3 dagen past niet in een gat tussen twee klussen door.
 * Hier wordt daarom gezocht naar een reeks aaneengesloten VRIJE werkdagen:
 * weekenden en niet-werkdagen onderbreken de reeks niet, een bestaande
 * afspraak wel. Een halve dag bezet telt als een hele dag bezet — je stuurt
 * een keuken niet half het huis in.
 */
function montageBlokken(opts: Zoekopdracht): Slot[] {
  const { vanaf, dagen, profiel, bezet, klantPc4 } = opts;
  const aantal = opts.aantal ?? 3;
  const perWeek = weekbezetting(bezet);

  const benodigdeDagen = Math.ceil(profiel.montage_duur_dagdelen / DAGDELEN_PER_DAG);
  const dagdelen = profiel.montage_duur_dagdelen;

  // Alle werkdagen in het venster, met de vraag: is deze dag helemaal vrij?
  const werkdagen: { dag: Date; vrij: boolean }[] = [];
  const loop = new Date(vanaf);
  loop.setHours(0, 0, 0, 0);

  for (let i = 0; i < dagen; i++, loop.setDate(loop.getDate() + 1)) {
    if (!profiel.werkdagen.includes(isoWeekdag(loop))) continue;

    const dagStart = metTijd(loop, profiel.werkdag_start);
    const dagEind = metTijd(loop, profiel.werkdag_eind);
    if (dagEind <= vanaf) continue;

    const vrij = !bezet.some((b) => b.start < dagEind && b.eind > dagStart);
    werkdagen.push({ dag: new Date(loop), vrij });
  }

  const gevonden: Slot[] = [];
  // De dag ná een meerdaagse klus vrijhouden: het blok moet dus één werkdag
  // langer vrij zijn dan de montage zelf duurt.
  const hersteldag = profiel.hersteldag_na_meerdaagse !== false && benodigdeDagen > 1;
  const vrijTeHouden = benodigdeDagen + (hersteldag ? 1 : 0);

  for (let i = 0; i + vrijTeHouden <= werkdagen.length && gevonden.length < aantal; i++) {
    const reeks = werkdagen.slice(i, i + benodigdeDagen);
    const metHerstel = werkdagen.slice(i, i + vrijTeHouden);
    if (!metHerstel.every((d) => d.vrij)) continue;

    // De buffer wordt per kalenderweek getoetst; een montage over een
    // weekgrens heen belast beide weken.
    const dagdelenPerWeek = new Map<string, number>();
    for (const d of reeks) {
      const k = weeksleutel(d.dag);
      dagdelenPerWeek.set(k, (dagdelenPerWeek.get(k) ?? 0) + DAGDELEN_PER_DAG);
    }
    const bufferOk = [...dagdelenPerWeek.entries()].every(([, dd]) =>
      pastBinnenBuffer(reeks[0].dag, dd, profiel, perWeek),
    );
    if (!bufferOk) continue;

    // Reistijd telt hier alleen op de aansluitende dagen ervoor en erna.
    const dagVoor = werkdagen[i - 1];
    const dagNa = werkdagen[i + vrijTeHouden];
    if (!randenHaalbaar(dagVoor, dagNa, bezet, profiel, klantPc4)) continue;

    gevonden.push({
      start: metTijd(reeks[0].dag, profiel.werkdag_start),
      eind: metTijd(reeks[reeks.length - 1].dag, profiel.werkdag_eind),
      soort: 'montage',
      dagen: benodigdeDagen,
    });

    // Volgende voorstel minstens een week later: drie aaneensluitende
    // startdata zijn voor de klant geen echte keuze.
    i += vrijTeHouden + 2;
    void dagdelen;
  }

  return gevonden.slice(0, aantal);
}

function randenHaalbaar(
  dagVoor: { dag: Date } | undefined,
  dagNa: { dag: Date } | undefined,
  bezet: Bezetting[],
  profiel: PlannerProfiel,
  klantPc4?: number,
): boolean {
  const buur = (d?: { dag: Date }) => {
    if (!d) return undefined;
    const s = metTijd(d.dag, profiel.werkdag_start);
    const e = metTijd(d.dag, profiel.werkdag_eind);
    return bezet.find((b) => b.start < e && b.eind > s);
  };

  for (const b of [buur(dagVoor), buur(dagNa)]) {
    if (b && reistijdMin(b.pc4, klantPc4) > profiel.max_reistijd_min) return false;
  }
  return true;
}

// ----------------------------------------------------------------- output

/** Een voorstel is 24 uur geldig; daarna vervalt de reservering vanzelf. */
export function vervaltOp(nu: Date = new Date()): Date {
  return new Date(+nu + 24 * 60 * MS_MIN);
}

export function formuleerVoorstel(slots: Slot[]): string {
  if (slots.length === 0) return '';

  const datum = new Intl.DateTimeFormat('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const tijd = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });

  if (slots[0].soort === 'montage') {
    const regels = slots
      .map((s) => `- vanaf ${datum.format(s.start)}, ${s.dagen} werkdagen`)
      .join('\n');
    return `Voor de montage heb ik deze periodes vrij:\n${regels}\n\nWelke past u het beste?`;
  }

  const regels = slots
    .map((s) => `- ${datum.format(s.start)} om ${tijd.format(s.start)}`)
    .join('\n');
  return `Ik kan op deze momenten langskomen om in te meten:\n${regels}\n\nWelke komt u het beste uit?`;
}
