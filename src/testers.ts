/**
 * Stresstest met vrienden.
 *
 * Een paar vrienden spelen klant op het botnummer. Hun nummers staan in
 * TESTNUMMERS in .env (niet in de code: deze repo is openbaar). Voor die
 * nummers gedraagt de bot zich bijna als bij een echte klant, met drie
 * verschillen:
 *
 *   1. `reset` wist hun gesprek, zodat ze een nieuw scenario kunnen spelen.
 *   2. Na inplannen of overdracht zwijgt de bot niet, maar begint hij een
 *      nieuw gesprek.
 *   3. Afspraken komen als [TEST] in de agenda (zie agenda.ts).
 *
 * Na elke update (andere git-versie dan bij de vorige melding) krijgen ze een
 * bericht dat ze opnieuw kunnen testen, en zijn hun oude gesprekken gewist.
 * Een herstart door systemd zonder nieuwe code stuurt niets.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** 06…, +316…, 00316…, 316… → 316…  (31 + 9 cijfers, zoals de rest van de bot). */
export function normaliseerNummer(n: string): string {
  let d = n.replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '31' + d.slice(1);
  return d;
}

export function leesTestnummers(waarde: string | undefined): Set<string> {
  return new Set(
    (waarde ?? '')
      .split(/[,;\s]+/)
      .map((n) => n.trim())
      .filter(Boolean)
      .map(normaliseerNummer)
      .filter((n) => n.length >= 10),
  );
}

/** Is dit bericht het reset-commando? Alleen het woord zelf, niets eromheen. */
export function isReset(tekst: string): boolean {
  return /^\s*reset\s*[.!]?\s*$/i.test(tekst);
}

export const UPDATE_TEKST =
  'Pico is geüpdatet en verbeterd. U kunt mij nu als testpersoon opnieuw stresstesten. ' +
  "Uw vorige gesprek is gewist. Stuur tussendoor 'reset' om opnieuw te beginnen.";

export const RESET_TEKST =
  'Gesprek gewist. U kunt opnieuw beginnen alsof u een nieuwe klant bent.';

export const NIEUW_GESPREK_TEKST =
  '(Testmodus: het vorige gesprek is afgerond. Bij een echte klant zou de monteur het nu overnemen. ' +
  'Dit bericht behandel ik als een nieuwe aanvraag.)';

/** De versie van de code die nu draait: de git-commit in de werkmap. */
export function huidigeVersie(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function laatstGemeld(bestand: string): string | null {
  try {
    return readFileSync(bestand, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function onthoudGemeld(bestand: string, versie: string): void {
  writeFileSync(bestand, versie + '\n');
}
