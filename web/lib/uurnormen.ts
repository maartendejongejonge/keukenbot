import type { Uurnormen } from './types';
export type { Uurnormen };

/**
 * De velden van de uurnormen (src/prijs.ts) met uitleg, in de volgorde
 * waarin een monteur over een keuken nadenkt. `sleutel` met een punt is een
 * genest veld: kast_bouwpakket.onder → { kast_bouwpakket: { onder } }.
 */
export const UURNORM_VELDEN: { sleutel: string; groep: string; tekst: string; eenheid: string; max?: number }[] = [
  { sleutel: 'kast_bouwpakket.onder', groep: 'Kasten in elkaar zetten en plaatsen (bouwpakket, zoals IKEA)', tekst: 'Onderkast', eenheid: 'uur per kast' },
  { sleutel: 'kast_bouwpakket.hang', groep: 'Kasten in elkaar zetten en plaatsen (bouwpakket, zoals IKEA)', tekst: 'Hangkast', eenheid: 'uur per kast' },
  { sleutel: 'kast_bouwpakket.hoog', groep: 'Kasten in elkaar zetten en plaatsen (bouwpakket, zoals IKEA)', tekst: 'Hoge kast', eenheid: 'uur per kast' },
  { sleutel: 'kast_voorgemonteerd.onder', groep: 'Kasten plaatsen (voorgemonteerd, zoals Nobilia)', tekst: 'Onderkast', eenheid: 'uur per kast' },
  { sleutel: 'kast_voorgemonteerd.hang', groep: 'Kasten plaatsen (voorgemonteerd, zoals Nobilia)', tekst: 'Hangkast', eenheid: 'uur per kast' },
  { sleutel: 'kast_voorgemonteerd.hoog', groep: 'Kasten plaatsen (voorgemonteerd, zoals Nobilia)', tekst: 'Hoge kast', eenheid: 'uur per kast' },
  { sleutel: 'grens_kasten', groep: 'Klein of groot', tekst: 'Vanaf hoeveel kasten is een keuken groot', eenheid: 'kasten', max: 100 },
  { sleutel: 'stellen_ophangen.klein', groep: 'Klein of groot', tekst: 'Stellen en ophangen, kleine keuken', eenheid: 'uur' },
  { sleutel: 'stellen_ophangen.groot', groep: 'Klein of groot', tekst: 'Stellen en ophangen, grote keuken', eenheid: 'uur' },
  { sleutel: 'fronten_plinten.klein', groep: 'Klein of groot', tekst: 'Fronten en plinten, kleine keuken', eenheid: 'uur' },
  { sleutel: 'fronten_plinten.groot', groep: 'Klein of groot', tekst: 'Fronten en plinten, grote keuken', eenheid: 'uur' },
  { sleutel: 'opruimen.klein', groep: 'Klein of groot', tekst: 'Opruimen, kleine keuken', eenheid: 'uur' },
  { sleutel: 'opruimen.groot', groep: 'Klein of groot', tekst: 'Opruimen, grote keuken', eenheid: 'uur' },
  { sleutel: 'werkblad', groep: 'Werkblad en eiland', tekst: 'Werkblad plaatsen', eenheid: 'uur' },
  { sleutel: 'werkblad_hoek_extra', groep: 'Werkblad en eiland', tekst: 'Extra bij een hoekblad', eenheid: 'uur' },
  { sleutel: 'eiland_extra', groep: 'Werkblad en eiland', tekst: 'Extra bij een kookeiland', eenheid: 'uur' },
  { sleutel: 'water_basis', groep: 'Water en apparatuur', tekst: 'Water aansluiten (basis)', eenheid: 'uur' },
  { sleutel: 'waterpunt', groep: 'Water en apparatuur', tekst: 'Per extra waterpunt (vaatwasser, Quooker)', eenheid: 'uur' },
  { sleutel: 'apparaat', groep: 'Water en apparatuur', tekst: 'Per inbouwapparaat', eenheid: 'uur' },
  { sleutel: 'kookplaat', groep: 'Water en apparatuur', tekst: 'Kookplaat aansluiten', eenheid: 'uur' },
  { sleutel: 'verdieping_zonder_lift', groep: 'Overig', tekst: 'Sjouwen per verdieping zonder lift', eenheid: 'uur' },
  { sleutel: 'uren_per_dag', groep: 'Overig', tekst: 'Werkuren per dag', eenheid: 'uur', max: 14 },
  { sleutel: 'bandbreedte_pct', groep: 'Overig', tekst: 'Bandbreedte van de indicatie', eenheid: '%', max: 50 },
];

/** Startwaarden voor een monteur die nog geen eigen uurnormen heeft. */
export const STANDAARD_UURNORMEN: Uurnormen = {
  kast_bouwpakket: { onder: 0.75, hang: 0.6, hoog: 1.25 },
  kast_voorgemonteerd: { onder: 0.25, hang: 0.25, hoog: 0.5 },
  grens_kasten: 10,
  stellen_ophangen: { klein: 3, groot: 4 },
  fronten_plinten: { klein: 4, groot: 6 },
  opruimen: { klein: 1.5, groot: 2 },
  werkblad: 3,
  werkblad_hoek_extra: 1,
  eiland_extra: 3,
  water_basis: 1.5,
  waterpunt: 0.75,
  apparaat: 0.75,
  kookplaat: 1,
  verdieping_zonder_lift: 0.5,
  uren_per_dag: 8,
  bandbreedte_pct: 10,
};

export function uurnormWaarde(u: Uurnormen | null, sleutel: string): number | undefined {
  const bron = (u ?? STANDAARD_UURNORMEN) as unknown as Record<string, unknown>;
  const [a, b] = sleutel.split('.');
  const v = b ? (bron[a] as Record<string, number> | undefined)?.[b] : bron[a];
  return typeof v === 'number' ? v : undefined;
}
