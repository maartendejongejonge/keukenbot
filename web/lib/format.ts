import type { LeadStatus } from './types';

const TZ = 'Europe/Amsterdam';

export const datumTijd = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  }).format(new Date(iso));

export const datum = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date(iso));

export const tijd = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso));

/** "3 min geleden", "gisteren 14:02", "ma 6 okt". */
export function wanneer(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sec = (Date.now() - +d) / 1000;
  if (sec < 60) return 'zojuist';
  if (sec < 3600) return `${Math.floor(sec / 60)} min geleden`;
  if (sec < 6 * 3600) return `${Math.floor(sec / 3600)} uur geleden`;
  const vandaag = new Date().toLocaleDateString('nl-NL', { timeZone: TZ });
  const gister = new Date(Date.now() - 864e5).toLocaleDateString('nl-NL', { timeZone: TZ });
  const dag = d.toLocaleDateString('nl-NL', { timeZone: TZ });
  if (dag === vandaag) return `vandaag ${tijd(iso)}`;
  if (dag === gister) return `gisteren ${tijd(iso)}`;
  return new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }).format(d);
}

export const euro = (n: number | null | undefined) =>
  n == null ? '' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n));

/** Status zoals een monteur hem leest, met een toon voor de kleur. */
export const STATUS: Record<LeadStatus, { tekst: string; toon: 'bezig' | 'goed' | 'actie' | 'stil' }> = {
  nieuw:          { tekst: 'Nieuw',             toon: 'bezig' },
  kwalificeren:   { tekst: 'In gesprek',        toon: 'bezig' },
  gekwalificeerd: { tekst: 'Datum voorgesteld', toon: 'bezig' },
  ingepland:      { tekst: 'Ingepland',         toon: 'goed' },
  overgedragen:   { tekst: 'Bij jou',           toon: 'actie' },
  afgewezen:      { tekst: 'Afgewezen',         toon: 'stil' },
  verlopen:       { tekst: 'Verlopen',          toon: 'stil' },
};

export const SOORT: Record<string, string> = {
  inmeting: 'Inmeting',
  montage: 'Montage',
  klusje: 'Klusje',
};

/** Redenen van een overdracht of seintje (src/orchestrator.ts, runner.ts). */
export const REDEN: Record<string, string> = {
  prijsvraag: 'Prijs of budget',
  prijsbezwaar: 'Prijsbezwaar',
  klacht: 'Klacht',
  wil_monteur: 'Vraagt naar jou',
  twijfel: 'Bot twijfelde',
  buiten_regels: 'Kon niet inplannen',
  zakelijk: 'Zakelijke aanvraag',
  extra_werk: 'Werk zonder vaste prijs',
  budget: 'Budget te laag',
  buiten_werkgebied: 'Buiten werkgebied',
  klus_niet_aangenomen: 'Doe je niet',
  klusje_buiten_gebied: 'Klusje buiten gebied',
  lage_confidence: 'Bot wist het niet zeker',
  levertijd: 'Vraag over levertijd',
  emotie: 'Klant is boos of heeft haast',
};

/** Samenvattingen bevatten soms markdown van het model (**vet**, ---). Voor het scherm weghalen. */
export function kaleTekst(t: string): string {
  return t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*-{3,}\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 31612345678 → 06-12345678 */
export function nummer(n: string | null | undefined): string {
  if (!n) return '';
  const d = n.replace(/\D/g, '');
  if (d.startsWith('316') && d.length === 11) return `06-${d.slice(3)}`;
  if (d.startsWith('31') && d.length === 11) return `0${d.slice(2)}`;
  return n;
}

/** 06-12345678 / +31 6 12345678 → 31612345678. Leeg als het geen NL-mobiel lijkt. */
export function normaliseerNummer(tekst: string): string | null {
  let d = tekst.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('06') && d.length === 10) d = '31' + d.slice(1);
  if (/^316\d{8}$/.test(d)) return d;
  return null;
}

/** Werkdagen zoals de planner ze telt: 1 = maandag … 7 = zondag. */
export const DAGEN: [number, string][] = [[1, 'ma'], [2, 'di'], [3, 'wo'], [4, 'do'], [5, 'vr'], [6, 'za'], [7, 'zo']];
