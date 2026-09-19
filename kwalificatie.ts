/**
 * De zeven kwalificatievelden en de harde grenzen uit het productplan.
 * Dit bestand is de enige plek waar staat wat de bot mag; de orchestrator
 * leest hier, verzint niets zelf.
 */

export type TypeKlus = 'montage' | 'ombouw' | 'losse_kast' | 'reparatie';

export interface Kwalificatie {
  pc4?: number;
  plaats?: string;
  type_klus?: TypeKlus;
  leverancier?: string;
  omvang?: string;
  installatiewerk?: string[];
  keuken_geleverd?: boolean;
  gewenste_periode?: string;
}

export interface MonteurProfiel {
  werkgebied_pc4: number[];
  max_reistijd_min: number;
  weigert: string[];
  toon: string;
  inmeting_duur_min: number;
  montage_duur_dagdelen: number;
}

/** Volgorde waarin de bot uitvraagt. Belangrijkste filter eerst. */
export const VELD_VOLGORDE: (keyof Kwalificatie)[] = [
  'pc4',
  'type_klus',
  'keuken_geleverd',
  'leverancier',
  'omvang',
  'installatiewerk',
  'gewenste_periode',
];

/** Max aantal vervolgvragen voordat de bot overdraagt. Uit het plan: 5. */
export const MAX_VERVOLGVRAGEN = 5;

export function volgendVeld(k: Kwalificatie): keyof Kwalificatie | null {
  return VELD_VOLGORDE.find((v) => k[v] === undefined || k[v] === null) ?? null;
}

export function isCompleet(k: Kwalificatie): boolean {
  return volgendVeld(k) === null;
}

// ------------------------------------------------------------------ filter

export type Oordeel =
  | { past: true }
  | { past: false; reden: string; nettetekst: string };

/**
 * Ja/nee-filter op basis van het profiel. Draait vóór elk slotvoorstel.
 * Twijfel is geen 'nee' maar een overdracht — dat regelt de orchestrator.
 */
export function beoordeel(k: Kwalificatie, p: MonteurProfiel): Oordeel {
  if (k.pc4 !== undefined && p.werkgebied_pc4.length > 0 && !p.werkgebied_pc4.includes(k.pc4)) {
    return {
      past: false,
      reden: 'buiten_werkgebied',
      nettetekst:
        'Dat ligt helaas buiten mijn werkgebied, dus ik kan de klus niet aannemen. ' +
        'Succes met het vinden van een monteur bij u in de buurt.',
    };
  }

  if (k.type_klus && p.weigert.includes(k.type_klus)) {
    return {
      past: false,
      reden: 'klus_niet_aangenomen',
      nettetekst:
        'Dit soort werk doe ik niet, dus ik kan u hier niet mee helpen. ' +
        'Bedankt voor uw aanvraag.',
    };
  }

  return { past: true };
}

// ------------------------------------------------------- de harde grenzen

/**
 * Situaties waarin de bot stopt en overdraagt aan de monteur.
 * Dit is de regel die het product verkoopbaar maakt: liever een overdracht
 * te veel dan één klant die een verkeerde toezegging krijgt.
 */
export const OVERDRACHT_REDENEN = [
  'prijsvraag',      // klant vraagt om een bedrag
  'levertijd',       // klant vraagt wanneer materiaal er is
  'klacht',          // bestaande klus, iets mis
  'emotie',          // boos, haast, verdrietig
  'lage_confidence', // model weet het niet
  'buiten_regels',   // alles wat hierboven niet past
] as const;

export type OverdrachtReden = (typeof OVERDRACHT_REDENEN)[number];

/** Onder deze drempel gaat het bericht naar de reviewqueue in plaats van naar de klant. */
export const CONFIDENCE_DREMPEL = 0.75;

export function systeemprompt(p: MonteurProfiel): string {
  return `Je beantwoordt WhatsApp-berichten namens een zelfstandige keukenmonteur.

Toon: ${p.toon}. Kort, in het Nederlands, geen uitroeptekens, geen emoji.
Je schrijft zoals een vakman schrijft: gewone zinnen, geen verkooppraat.

JE DOEL
Achterhaal in zo min mogelijk berichten deze gegevens en niets anders:
postcode, type klus, of de keuken al geleverd is, leverancier of merk,
omvang (aantal kasten of strekkende meters), of er water/elektra/afvoer-werk
bij zit, en in welke periode de klant het wil.
Stel per bericht hooguit twee vragen. Na ${MAX_VERVOLGVRAGEN} vervolgvragen
stop je en draag je over aan de monteur.

WAT JE NOOIT DOET
- Een prijs, tarief, uurloon of indicatie noemen. Ook niet bij benadering.
- Een datum of dagdeel toezeggen dat je niet uit de agenda hebt gekregen.
- Iets zeggen over levertijden van keukens of materiaal.
- Doorgaan als de klant boos is, klaagt over eerder werk, of als je het
  antwoord niet zeker weet.

In al die gevallen antwoord je niet zelf, maar geef je aan dat de monteur
er zelf naar kijkt en vandaag nog reageert.

Je bent geen verkoper en geen adviseur. Je bent het loket.`;
}
