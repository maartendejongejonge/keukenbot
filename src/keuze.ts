/**
 * De klant heeft drie momenten voorgesteld gekregen. Welke kiest hij?
 *
 * Eerst een snelle check op een kaal cijfer ("2", "optie 1", "de eerste"),
 * pas daarna het taalmodel. Het model krijgt dezelfde gespreksregels als
 * altijd, plus de lijst met opties, en geeft terug:
 *   - keuze: 1, 2 of 3 — of null;
 *   - geen_past: de klant wil een ander moment;
 *   - antwoord: als de klant iets anders vraagt, een kort antwoord dat
 *     afsluit met de vraag welke optie past.
 */

import type { Slot } from './planner.js';

export interface KeuzeUitkomst {
  keuze: number | null;        // 1-gebaseerd
  geen_past: boolean;
  antwoord: string;
  confidence: number;
  /** als de klant zegt wanneer het wél kan */
  vanaf?: Date;
  signaal?: string | null;
}

const RANGTELWOORDEN: Record<string, number> = {
  eerste: 1, eerst: 1, een: 1, één: 1, '1e': 1,
  tweede: 2, twee: 2, '2e': 2,
  derde: 3, drie: 3, '3e': 3,
};

/** Alleen eenduidige korte antwoorden; al het andere gaat naar het model. */
export function snelleKeuze(tekst: string, aantal: number): number | null {
  const t = tekst.toLowerCase().replace(/[.!,]/g, ' ').trim();
  if (t.length > 25) return null;

  const cijfer = t.match(/^(?:optie|nummer|nr|de)?\s*([1-9])\s*(?:graag|aub|svp|is goed|past)?$/);
  if (cijfer) {
    const n = Number(cijfer[1]);
    return n >= 1 && n <= aantal ? n : null;
  }

  const woord = t.match(/^(?:de\s+)?(eerste|tweede|derde|1e|2e|3e)(?:\s+(?:optie|graag|is goed|past))?$/);
  if (woord) {
    const n = RANGTELWOORDEN[woord[1]];
    return n <= aantal ? n : null;
  }
  return null;
}

const datum = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam',
});
const tijd = new Intl.DateTimeFormat('nl-NL', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam',
});

export function omschrijfSlot(s: Pick<Slot, 'soort' | 'start' | 'dagen'>): string {
  return s.soort === 'montage'
    ? `vanaf ${datum.format(s.start)}${s.dagen ? `, ${s.dagen} werkdagen` : ''}`
    : `${datum.format(s.start)} om ${tijd.format(s.start)}`;
}

/** Extra instructie bovenop de gewone systeemprompt. */
export function keuzePrompt(slots: Pick<Slot, 'soort' | 'start' | 'dagen'>[]): string {
  return `DE KLANT KREEG DEZE MOMENTEN VOORGESTELD
${slots.map((s, i) => `${i + 1}. ${omschrijfSlot(s)}`).join('\n')}

Bepaal wat de klant met zijn bericht bedoelt.
- Kiest hij duidelijk één van deze momenten (ook in eigen woorden, zoals
  "dinsdag is goed" of "de laatste"): zet "keuze" op het nummer.
- Past geen van deze momenten, of wil hij een andere datum: "geen_past": true.
  Noemt hij vanaf wanneer het wel kan, zet dat in "vanaf" (YYYY-MM-DD).
  Zeg zelf geen datum toe; het systeem stuurt nieuwe momenten. Zet in
  "antwoord" dan alleen een korte inleiding ("Dan stel ik andere momenten voor.").
- Vraagt hij iets anders: beantwoord dat kort volgens de regels en sluit af
  met de vraag welk moment past. "keuze" blijft null.
- Twijfel je welk moment hij bedoelt: "keuze" null en vraag het kort na.

Antwoord uitsluitend met JSON, zonder toelichting of code-fences:
{"keuze":null,"geen_past":false,"vanaf":null,"antwoord":"","confidence":0.0,"signaal":null}
"signaal" = null, of "prijsbezwaar", "klacht", "wil_monteur" of "twijfel"
  (alleen een seintje aan de monteur; jij blijft het gesprek voeren).`;
}

export function leesKeuze(ruw: any, aantal: number): KeuzeUitkomst {
  const k = Number(ruw?.keuze);
  return {
    keuze: Number.isInteger(k) && k >= 1 && k <= aantal ? k : null,
    geen_past: ruw?.geen_past === true,
    antwoord: typeof ruw?.antwoord === 'string' ? ruw.antwoord : '',
    confidence: Number(ruw?.confidence) || 0,
    vanaf: /^\d{4}-\d{2}-\d{2}$/.test(String(ruw?.vanaf)) ? new Date(`${ruw.vanaf}T00:00:00`) : undefined,
    signaal: ruw?.signaal ?? null,
  };
}
