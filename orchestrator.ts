/**
 * De kern: één inkomend bericht erin, één besluit eruit.
 *
 * Er zijn precies vier uitkomsten. Alles wat er niet in past wordt een
 * overdracht — nooit een gok.
 */

import {
  CONFIDENCE_DREMPEL,
  Kwalificatie,
  MAX_VERVOLGVRAGEN,
  MonteurProfiel,
  OverdrachtReden,
  beoordeel,
  isCompleet,
  systeemprompt,
  volgendVeld,
} from './kwalificatie.js';
import { Bezetting, PlannerProfiel, Slot, formuleerVoorstel, vervaltOp, vrijeSlots } from './planner.js';

export type Besluit =
  | { soort: 'antwoord'; tekst: string; kwalificatie: Kwalificatie }
  | { soort: 'afwijzing'; tekst: string; reden: string }
  | {
      soort: 'voorstel';
      tekst: string;
      slots: Slot[];
      vervalt_op: Date;
    }
  | { soort: 'overdracht'; reden: OverdrachtReden; samenvatting: string; concept?: string };

export interface LeadContext {
  kwalificatie: Kwalificatie;
  vervolgvragen: number;
  historie: { afzender: 'klant' | 'bot' | 'monteur'; tekst: string }[];
}

/** Wat het taalmodel per bericht teruggeeft. Strak JSON, niets anders. */
interface ModelUitkomst {
  velden: Partial<Kwalificatie>;
  antwoord: string;
  confidence: number;
  overdracht?: OverdrachtReden;
}

export interface Afhankelijkheden {
  /** Roept Claude aan met de systeemprompt en verwacht JSON terug. */
  duidBericht(
    systeem: string,
    historie: LeadContext['historie'],
    bericht: string,
    gevraagdVeld: keyof Kwalificatie | null,
  ): Promise<ModelUitkomst>;
  /** Bestaande afspraken uit Google Agenda, inclusief postcode waar bekend. */
  bezetting(vanaf: Date, dagen: number): Promise<Bezetting[]>;
}

export async function verwerkBericht(
  bericht: string,
  ctx: LeadContext,
  profiel: MonteurProfiel & PlannerProfiel,
  deps: Afhankelijkheden,
): Promise<Besluit> {
  const gevraagd = volgendVeld(ctx.kwalificatie);

  const uit = await deps.duidBericht(
    systeemprompt(profiel),
    ctx.historie,
    bericht,
    gevraagd,
  );

  // 1. Het model geeft zelf aan dat dit niet voor de bot is.
  if (uit.overdracht) {
    return {
      soort: 'overdracht',
      reden: uit.overdracht,
      samenvatting: vatSamen(ctx, bericht, uit.overdracht),
      concept: uit.antwoord || undefined,
    };
  }

  // 2. Te onzeker om zelf te antwoorden.
  if (uit.confidence < CONFIDENCE_DREMPEL) {
    return {
      soort: 'overdracht',
      reden: 'lage_confidence',
      samenvatting: vatSamen(ctx, bericht, 'lage_confidence'),
      concept: uit.antwoord || undefined,
    };
  }

  const kwalificatie: Kwalificatie = { ...ctx.kwalificatie, ...schoon(uit.velden) };

  // 3. Filter draait zodra er genoeg bekend is — niet pas aan het eind.
  const oordeel = beoordeel(kwalificatie, profiel);
  if (!oordeel.past) {
    return { soort: 'afwijzing', tekst: oordeel.nettetekst, reden: oordeel.reden };
  }

  // 4. Nog niet compleet: doorvragen, tot de grens.
  if (!isCompleet(kwalificatie)) {
    if (ctx.vervolgvragen + 1 > MAX_VERVOLGVRAGEN) {
      return {
        soort: 'overdracht',
        reden: 'buiten_regels',
        samenvatting: vatSamen(ctx, bericht, 'buiten_regels'),
      };
    }
    return { soort: 'antwoord', tekst: uit.antwoord, kwalificatie };
  }

  // 5. Compleet en passend: agenda raadplegen.
  const soort: 'inmeting' | 'montage' =
    kwalificatie.keuken_geleverd === true ? 'montage' : 'inmeting';

  const bezet = await deps.bezetting(new Date(), 28);
  const slots = vrijeSlots({
    vanaf: new Date(),
    dagen: 28,
    soort,
    profiel,
    bezet,
    klantPc4: kwalificatie.pc4,
  });

  // Geen vrij slot is geen "het lukt niet" naar de klant toe — dat beslist de monteur.
  if (slots.length === 0) {
    return {
      soort: 'overdracht',
      reden: 'buiten_regels',
      samenvatting:
        `Gekwalificeerde aanvraag, maar geen vrij ${soort}-slot binnen vier weken. ` +
        vatSamen(ctx, bericht, 'buiten_regels'),
    };
  }

  return {
    soort: 'voorstel',
    tekst: formuleerVoorstel(slots),
    slots,
    vervalt_op: vervaltOp(),
  };
}

function schoon(v: Partial<Kwalificatie>): Partial<Kwalificatie> {
  const uit: Partial<Kwalificatie> = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === null || val === undefined || val === '') continue;
    (uit as Record<string, unknown>)[k] = val;
  }
  return uit;
}

function vatSamen(ctx: LeadContext, bericht: string, reden: OverdrachtReden): string {
  const k = ctx.kwalificatie;
  const bekend = [
    k.plaats ?? (k.pc4 ? String(k.pc4) : null),
    k.type_klus,
    k.leverancier,
    k.omvang,
    k.keuken_geleverd === undefined ? null : k.keuken_geleverd ? 'keuken geleverd' : 'nog niet geleverd',
  ]
    .filter(Boolean)
    .join(', ');

  return `Reden: ${reden}. Bekend: ${bekend || 'nog niets'}. Laatste bericht: "${bericht}"`;
}
