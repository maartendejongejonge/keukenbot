/**
 * Reiskosten en rijtijd — zonder betaalde API.
 *
 * Werkwijze: elk tweecijferig postcodegebied heeft een middelpunt. We rekenen
 * de hemelsbrede afstand tussen twee middelpunten en vermenigvuldigen die met
 * een omwegfactor voor het wegennet.
 *
 * NAUWKEURIGHEID: reken op 10 tot 15 procent afwijking, en meer bij routes
 * over water (Zeeland, de Waddeneilanden). Voor een offerte-indicatie is dat
 * prima; het is geen navigatiesysteem. Controleer zelf bij een verre klus.
 *
 * De klant krijgt hier niets van te zien. De bot noemt geen bedragen; de
 * berekening landt in het overzicht van de aanvraag, bij de monteur.
 */

export interface ReisProfiel {
  vertrekPc4: number;         // waar de monteur 's ochtends vandaan komt
  kmTarief: number;           // euro per kilometer
  uurtarief: number;          // euro per uur
  reisuurPercentage: number;  // 50 = reisuren tegen half tarief
  gratisPc4: number[];        // hierbinnen niets doorrekenen
  hotelRichtprijs?: number;   // vanaf welk bedrag overnachten voordeliger is
}

export interface Reis {
  afstandKm: number;          // enkele reis
  rijtijdMin: number;         // enkele reis
  gratis: boolean;
  kilometerkosten: number;    // heen en terug
  reisurenkosten: number;     // heen en terug
  totaal: number;             // per dag
  schatting: true;            // altijd waar: dit is geen gemeten route
}

/** Omweg over echte wegen ten opzichte van de rechte lijn. */
const OMWEGFACTOR = 1.33;

/** Middelpunten per tweecijferig postcodegebied. */
const MIDDELPUNTEN: Record<number, [number, number]> = {
  10: [52.37, 4.90], 11: [52.31, 4.94], 12: [52.23, 5.17], 13: [52.37, 5.22],
  14: [52.30, 5.08], 15: [52.44, 4.83], 16: [52.51, 4.96], 17: [52.87, 4.79],
  18: [52.63, 4.75], 19: [52.47, 4.63], 20: [52.38, 4.64], 21: [52.28, 4.58],
  22: [52.20, 4.44], 23: [52.16, 4.49], 24: [52.13, 4.66], 25: [52.08, 4.30],
  26: [52.01, 4.36], 27: [52.06, 4.49], 28: [52.02, 4.71], 29: [51.93, 4.58],
  30: [51.92, 4.48], 31: [51.90, 4.47], 32: [51.91, 4.34], 33: [51.81, 4.67],
  34: [52.03, 5.09], 35: [52.09, 5.11], 36: [52.14, 5.03], 37: [52.09, 5.23],
  38: [52.16, 5.39], 39: [52.03, 5.56], 40: [51.89, 5.43], 41: [51.89, 5.10],
  42: [51.83, 4.97], 43: [51.65, 3.92], 44: [51.47, 3.99], 45: [51.33, 3.98],
  46: [51.47, 3.60], 47: [51.66, 4.60], 48: [51.59, 4.78], 49: [51.64, 4.86],
  50: [51.56, 5.09], 51: [51.69, 5.07], 52: [51.70, 5.30], 53: [51.81, 5.24],
  54: [51.66, 5.61], 55: [51.35, 5.46], 56: [51.44, 5.48], 57: [51.48, 5.66],
  58: [51.76, 5.52], 59: [51.53, 5.97], 60: [51.37, 6.17], 61: [51.19, 5.99],
  62: [50.85, 5.69], 63: [50.99, 5.86], 64: [50.89, 5.98], 65: [51.84, 5.86],
  66: [51.81, 5.73], 67: [51.98, 5.90], 68: [52.00, 5.90], 69: [51.93, 6.07],
  70: [51.97, 6.29], 71: [51.97, 6.72], 72: [52.14, 6.20], 73: [52.21, 5.97],
  74: [52.25, 6.16], 75: [52.22, 6.89], 76: [52.36, 6.66], 77: [52.58, 6.62],
  78: [52.70, 6.19], 79: [52.51, 6.09], 80: [52.51, 6.09], 81: [52.39, 6.28],
  82: [52.56, 5.91], 83: [52.71, 5.75], 84: [52.87, 5.99], 85: [53.03, 5.66],
  86: [53.17, 5.42], 87: [53.06, 5.53], 88: [53.20, 5.80], 89: [53.32, 5.99],
  90: [53.09, 5.83], 91: [53.05, 6.00], 92: [53.10, 6.10], 93: [52.99, 6.56],
  94: [53.10, 6.87], 95: [53.16, 6.76], 96: [53.14, 7.03], 97: [53.22, 6.57],
  98: [53.33, 6.85], 99: [53.35, 6.65],
};

export function middelpunt(pc4: number): [number, number] | null {
  return MIDDELPUNTEN[Math.floor(pc4 / 100)] ?? null;
}

export function hemelsbreedKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Gemiddelde snelheid loopt op met de afstand: een korte rit is stad,
 * een lange rit is grotendeels snelweg.
 */
function gemiddeldeSnelheid(km: number): number {
  if (km < 5) return 25;
  if (km < 15) return 35;
  if (km < 40) return 55;
  if (km < 100) return 75;
  return 85;
}

export function afstand(vanPc4: number, naarPc4: number): { km: number; min: number } {
  const a = middelpunt(vanPc4);
  const b = middelpunt(naarPc4);

  // Onbekende postcode: geef een ruime schatting terug in plaats van nul,
  // zodat een fout nooit leidt tot "gratis en om de hoek".
  if (!a || !b) return { km: 60, min: 60 };

  // Binnen hetzelfde postcodegebied is het middelpunt-verschil nul; reken
  // dan met een vaste binnenstedelijke rit.
  if (Math.floor(vanPc4 / 100) === Math.floor(naarPc4 / 100)) {
    return { km: 6, min: 15 };
  }

  const km = hemelsbreedKm(a, b) * OMWEGFACTOR;
  return { km, min: (km / gemiddeldeSnelheid(km)) * 60 };
}

export function reis(naarPc4: number, p: ReisProfiel): Reis {
  const { km, min } = afstand(p.vertrekPc4, naarPc4);
  const gratis = p.gratisPc4.includes(naarPc4);

  // Heen en terug. Bij een meerdaagse klus rijdt hij elke dag opnieuw;
  // dat vermenigvuldigen doet `samenvatting`, niet deze functie.
  const kilometerkosten = gratis ? 0 : rond(km * 2 * p.kmTarief);
  const reisurenkosten = gratis
    ? 0
    : rond(((min * 2) / 60) * p.uurtarief * (p.reisuurPercentage / 100));

  return {
    afstandKm: Math.round(km),
    rijtijdMin: Math.round(min),
    gratis,
    kilometerkosten,
    reisurenkosten,
    totaal: rond(kilometerkosten + reisurenkosten),
    schatting: true,
  };
}

/** Wat de monteur te zien krijgt. Cijfers, geen advies. */
export function samenvatting(r: Reis, dagen = 1): string {
  if (r.gratis) {
    return `± ${r.afstandKm} km, ± ${r.rijtijdMin} min enkele reis — geen reiskosten.`;
  }
  const regels = [
    `± ${r.afstandKm} km, ± ${r.rijtijdMin} min enkele reis (schatting)`,
    `Kilometers: € ${r.kilometerkosten.toFixed(2)} per dag`,
    `Reisuren: € ${r.reisurenkosten.toFixed(2)} per dag`,
  ];
  regels.push(
    dagen > 1
      ? `€ ${r.totaal.toFixed(2)} × ${dagen} dagen = € ${rond(r.totaal * dagen).toFixed(2)}`
      : `Totaal € ${r.totaal.toFixed(2)}`,
  );
  return regels.join('\n');
}

/**
 * Is overnachten goedkoper dan elke dag heen en weer?
 *
 * Bij N dagen thuis slapen rijd je N keer retour. Bij overnachten rijd je
 * één keer retour plus N-1 nachten hotel. Het scheelt dus (N-1) × (dagkosten
 * min hotelprijs) — positief zodra een dag rijden duurder is dan een bed.
 *
 * Dit is uitsluitend voor de monteur. De klant hoort hier niets over: de bot
 * noemt geen bedragen en beslist dit niet.
 */
export function overnachtingsAdvies(
  r: Reis,
  dagen: number,
  hotelPerNacht = 90,
): string | null {
  if (dagen < 2 || r.gratis) return null;
  if (r.totaal <= hotelPerNacht) return null;

  const nachten = dagen - 1;
  const besparing = rond(nachten * (r.totaal - hotelPerNacht));
  const urenGespaard = Math.round((nachten * r.rijtijdMin * 2) / 60);

  return (
    `Overnachten is hier waarschijnlijk voordeliger: ${nachten} ` +
    `${nachten === 1 ? 'nacht' : 'nachten'} hotel à ± € ${hotelPerNacht} ` +
    `scheelt ± € ${besparing.toFixed(2)} en ${urenGespaard} uur rijden. ` +
    `Niet met de klant gedeeld.`
  );
}

/** Voor de planner: alleen rijtijd tussen twee klussen. */export function rijtijdTussen(vanPc4?: number, naarPc4?: number): number {
  if (vanPc4 === undefined || naarPc4 === undefined) return 0;
  return Math.round(afstand(vanPc4, naarPc4).min);
}

function rond(n: number): number {
  return Math.round(n * 100) / 100;
}
