/**
 * De kern: één inkomend bericht erin, één besluit eruit.
 *
 * Er zijn precies vier uitkomsten. Alles wat er niet in past wordt een
 * overdracht — nooit een gok.
 *
 * Toont de monteur prijzen (zie prijs.ts), dan rekent de orchestrator zelf de
 * prijsindicatie uit zodra de gegevens compleet zijn en zet hij die vóór het
 * antwoord van het model. Het model noemt zelf nooit een bedrag.
 */

import {
  CONFIDENCE_DREMPEL,
  Kwalificatie,
  MAX_VERVOLGVRAGEN,
  MAX_VERVOLGVRAGEN_PRIJS,
  MonteurProfiel,
  OverdrachtReden,
  PrijsContext,
  antwoordFormaat,
  beoordeel,
  isCompleet,
  ontbrekendeVelden,
  systeemprompt,
} from './kwalificatie.js';
import { Bezetting, PlannerProfiel, Slot, formuleerVoorstel, vervaltOp, vrijeSlots } from './planner.js';
import { berekenPrijs, prijsOpbouw, prijsTekst, type PrijsProfiel, type Prijsindicatie, type Werk } from './prijs.js';

export type Signaal = 'prijsbezwaar';

export type Besluit =
  | { soort: 'antwoord'; tekst: string; kwalificatie: Kwalificatie; prijs?: Prijsindicatie; signaal?: Signaal }
  | { soort: 'afwijzing'; tekst: string; reden: string }
  | {
      soort: 'voorstel';
      tekst: string;
      slots: Slot[];
      vervalt_op: Date;
      kwalificatie: Kwalificatie;
      prijs?: Prijsindicatie;
    }
  | { soort: 'overdracht'; reden: OverdrachtReden; samenvatting: string; concept?: string; kwalificatie?: Kwalificatie };

export interface LeadContext {
  kwalificatie: Kwalificatie;
  vervolgvragen: number;
  historie: { afzender: 'klant' | 'bot' | 'monteur'; tekst: string }[];
  /** al eerder gegeven prijsindicatie; dan rekent de orchestrator niet opnieuw */
  prijsGegeven?: PrijsContext['gegeven'];
}

/** Wat het taalmodel per bericht teruggeeft. Strak JSON, niets anders. */
interface ModelUitkomst {
  velden: Partial<Kwalificatie>;
  antwoord: string;
  confidence: number;
  overdracht?: OverdrachtReden | null;
  signaal?: Signaal | null;
}

export interface Afhankelijkheden {
  /** Roept Claude aan met de systeemprompt (incl. antwoordformaat) en verwacht JSON terug. */
  duidBericht(
    systeem: string,
    historie: LeadContext['historie'],
    bericht: string,
  ): Promise<ModelUitkomst>;
  /** Bestaande afspraken uit Google Agenda, inclusief postcode waar bekend. */
  bezetting(vanaf: Date, dagen: number): Promise<Bezetting[]>;
}

export async function verwerkBericht(
  bericht: string,
  ctx: LeadContext,
  profiel: MonteurProfiel & PlannerProfiel,
  deps: Afhankelijkheden,
  prijsProfiel: PrijsProfiel | null = null,
): Promise<Besluit> {
  const prijzen = prijsProfiel !== null;
  const prijsCtx: PrijsContext | null = prijzen ? { gegeven: ctx.prijsGegeven } : null;

  // Het model ziet de prijsvolgorde al zodra het om een montage kan gaan.
  const voorlopig: Kwalificatie = { type_klus: 'montage', ...ctx.kwalificatie };
  const systeem =
    systeemprompt(profiel, prijsCtx) +
    '\n\n' +
    antwoordFormaat(prijzen, ontbrekendeVelden(voorlopig, prijzen));

  const uit = await deps.duidBericht(systeem, ctx.historie, bericht);

  // 1. Het model geeft zelf aan dat dit niet voor de bot is.
  if (uit.overdracht) {
    return {
      soort: 'overdracht',
      reden: uit.overdracht,
      samenvatting: vatSamen(ctx, bericht, uit.overdracht),
      concept: uit.antwoord || undefined,
      kwalificatie: samenvoegen(ctx.kwalificatie, uit.velden),
    };
  }

  // 2. Te onzeker om zelf te antwoorden.
  if (!(uit.confidence >= CONFIDENCE_DREMPEL)) {
    return {
      soort: 'overdracht',
      reden: 'lage_confidence',
      samenvatting: vatSamen(ctx, bericht, 'lage_confidence'),
      concept: uit.antwoord || undefined,
      kwalificatie: samenvoegen(ctx.kwalificatie, uit.velden),
    };
  }

  const kwalificatie = samenvoegen(ctx.kwalificatie, uit.velden);

  // 3. Filter draait zodra er genoeg bekend is — niet pas aan het eind.
  const oordeel = beoordeel(kwalificatie, profiel);
  if (!oordeel.past) {
    return { soort: 'afwijzing', tekst: oordeel.nettetekst, reden: oordeel.reden };
  }

  // 4. Prijsindicatie, één keer per aanvraag, zodra alles bekend is.
  let prijs: Prijsindicatie | undefined;
  if (prijsProfiel && kwalificatie.type_klus === 'montage' && !ctx.prijsGegeven) {
    const u = berekenPrijs(
      {
        werk: kwalificatie.werk ?? {},
        pc4: kwalificatie.pc4,
        verdieping: kwalificatie.verdieping,
        lift: kwalificatie.lift,
        werkblad_door: kwalificatie.werkblad_door,
        zakelijk: kwalificatie.zakelijk,
      },
      prijsProfiel,
    );

    if (u.soort === 'monteur') {
      return {
        soort: 'overdracht',
        reden: 'prijsvraag',
        samenvatting:
          `Prijs niet automatisch: ${u.reden}.\n` +
          (u.basis ? `Basis zonder dat werk:\n${prijsOpbouw(u.basis, prijsProfiel.uurtarief)}\n` : '') +
          vatSamen({ ...ctx, kwalificatie }, bericht, 'prijsvraag'),
        concept: uit.antwoord || undefined,
        kwalificatie,
      };
    }
    if (u.soort === 'indicatie') prijs = u.indicatie;
  }

  const metPrijs = (tekst: string) => (prijs ? `${prijsTekst(prijs)}\n\n${tekst}`.trim() : tekst);

  // 5. Nog niet compleet: doorvragen, tot de grens.
  if (!isCompleet(kwalificatie, prijzen)) {
    const max = prijzen && kwalificatie.type_klus === 'montage' ? MAX_VERVOLGVRAGEN_PRIJS : MAX_VERVOLGVRAGEN;
    if (ctx.vervolgvragen + 1 > max) {
      return {
        soort: 'overdracht',
        reden: 'buiten_regels',
        samenvatting: vatSamen({ ...ctx, kwalificatie }, bericht, 'buiten_regels'),
        kwalificatie,
      };
    }
    return {
      soort: 'antwoord',
      tekst: metPrijs(uit.antwoord),
      kwalificatie,
      prijs,
      signaal: uit.signaal ?? undefined,
    };
  }

  // Prijsbezwaar na het voorstel: zelf onderbouwen, monteur krijgt een seintje.
  if (uit.signaal === 'prijsbezwaar') {
    return { soort: 'antwoord', tekst: uit.antwoord, kwalificatie, signaal: 'prijsbezwaar' };
  }

  // 6. Compleet en passend: agenda raadplegen.
  const prijsFlow = prijzen && kwalificatie.type_klus === 'montage';
  const soort: 'inmeting' | 'montage' = prijsFlow
    ? kwalificatie.ingemeten === false ? 'inmeting' : 'montage'
    : kwalificatie.keuken_geleverd === true ? 'montage' : 'inmeting';

  // De duur van de montage volgt uit de prijsberekening; de buffer zit in de dagen.
  const dagenMax = prijs?.dagen_max ?? ctx.prijsGegeven?.dagen_max;
  const planProfiel = dagenMax ? { ...profiel, montage_duur_dagdelen: dagenMax * 2 } : profiel;

  // Niet plannen vóór de keuken er is: vroegst de dag na levering.
  const nu = new Date();
  const naLevering = kwalificatie.leverdatum ? new Date(`${kwalificatie.leverdatum}T00:00:00`) : null;
  naLevering?.setDate(naLevering.getDate() + 1);
  const vanaf = soort === 'montage' && naLevering && +naLevering > +nu ? naLevering : nu;

  const bezet = await deps.bezetting(vanaf, 28);
  const slots = vrijeSlots({
    vanaf,
    dagen: 28,
    soort,
    profiel: planProfiel,
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
        vatSamen({ ...ctx, kwalificatie }, bericht, 'buiten_regels'),
      concept: prijs ? prijsTekst(prijs) : undefined,
      kwalificatie,
    };
  }

  return {
    soort: 'voorstel',
    tekst: metPrijs(formuleerVoorstel(slots)),
    slots,
    vervalt_op: vervaltOp(),
    kwalificatie,
    prijs,
  };
}

// ------------------------------------------------------------------ hulpjes

function schoon<T extends object>(v: Partial<T> | undefined): Partial<T> {
  const uit: Partial<T> = {};
  for (const [k, val] of Object.entries(v ?? {})) {
    if (val === null || val === undefined || val === '') continue;
    (uit as Record<string, unknown>)[k] = val;
  }
  return uit;
}

/** Nieuwe velden over de oude heen; `werk` wordt per onderdeel samengevoegd. */
export function samenvoegen(oud: Kwalificatie, nieuw: Partial<Kwalificatie> | undefined): Kwalificatie {
  const n = schoon<Kwalificatie>(nieuw);
  const werk: Werk | undefined =
    n.werk || oud.werk ? { ...(oud.werk ?? {}), ...schoon<Werk>(n.werk) } : undefined;
  const uit: Kwalificatie = { ...oud, ...n };
  if (werk) uit.werk = werk;
  if (typeof uit.pc4 === 'string') uit.pc4 = Number(String(uit.pc4).slice(0, 4)) || undefined;
  if (uit.leverdatum && !/^\d{4}-\d{2}-\d{2}$/.test(uit.leverdatum)) delete uit.leverdatum;
  return uit;
}

function vatSamen(ctx: LeadContext, bericht: string, reden: OverdrachtReden): string {
  const k = ctx.kwalificatie;
  const w = k.werk;
  const kasten = w ? (w.onderkasten ?? 0) + (w.hangkasten ?? 0) + (w.hoge_kasten ?? 0) : 0;
  const bekend = [
    k.klant_naam,
    k.plaats ?? (k.pc4 ? String(k.pc4) : null),
    k.type_klus,
    k.leverancier,
    k.omvang,
    kasten ? `${kasten} kasten${w?.levering ? ` (${w.levering})` : ''}` : null,
    k.verdieping !== undefined ? `${k.verdieping}e verdieping${k.lift === false ? ' zonder lift' : ''}` : null,
    k.leverdatum ? `levering ${k.leverdatum}` : null,
    k.keuken_geleverd === undefined ? null : k.keuken_geleverd ? 'keuken geleverd' : 'nog niet geleverd',
  ]
    .filter(Boolean)
    .join(', ');

  return `Reden: ${reden}. Bekend: ${bekend || 'nog niets'}. Laatste bericht: "${bericht.slice(0, 500)}"`;
}
