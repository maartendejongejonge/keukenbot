/**
 * De kern: één inkomend bericht erin, één besluit eruit.
 *
 * De bot voert het gesprek zelf tot er een montagedag (of inmeting) is
 * ingepland. Pas dan neemt de monteur het over. Tot die tijd krijgt de
 * monteur hooguit een seintje (prijsbezwaar, klacht, twijfel), maar het
 * gesprek blijft bij de bot. Afgesproken met Maarten op 02-10-2026.
 *
 * Toont de monteur prijzen (zie prijs.ts), dan rekent de orchestrator zelf de
 * prijsindicatie uit zodra de gegevens compleet zijn en zet hij die vóór het
 * antwoord van het model. Het model noemt zelf nooit een bedrag.
 */

import {
  Kwalificatie,
  MonteurProfiel,
  OverdrachtReden,
  PrijsContext,
  antwoordFormaat,
  beoordeel,
  isCompleet,
  ontbrekendeVelden,
  systeemprompt,
  veldUitleg,
  volgendVeld,
  CONFIDENCE_DREMPEL,
} from './kwalificatie.js';
import { Bezetting, PlannerProfiel, Slot, formuleerVoorstel, vervaltOp, vrijeSlots } from './planner.js';
import { berekenPrijs, prijsTekst, type PrijsProfiel, type Prijsindicatie, type Werk } from './prijs.js';

/** Seintje aan de monteur. Het gesprek blijft bij de bot. */
export type Signaal = 'prijsbezwaar' | 'prijsvraag' | 'klacht' | 'wil_monteur' | 'twijfel' | 'extra_werk';

export type Besluit =
  | {
      soort: 'antwoord';
      tekst: string;
      kwalificatie: Kwalificatie;
      prijs?: Prijsindicatie;
      signalen: Signaal[];
      extraWerk?: string[];
    }
  | { soort: 'afwijzing'; tekst: string; reden: string }
  | {
      soort: 'voorstel';
      tekst: string;
      slots: Slot[];
      vervalt_op: Date;
      kwalificatie: Kwalificatie;
      prijs?: Prijsindicatie;
      signalen: Signaal[];
      extraWerk?: string[];
    }
  /** Alleen nog als de bot echt niet verder kan: geen vrije datum te vinden. */
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
  signaal?: Signaal | null;
  /** oud formaat; wordt omgezet naar een signaal */
  overdracht?: string | null;
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

const SIGNALEN: Signaal[] = ['prijsbezwaar', 'prijsvraag', 'klacht', 'wil_monteur', 'twijfel', 'extra_werk'];

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
  const kwalificatie = samenvoegen(ctx.kwalificatie, uit.velden);

  // Seintjes verzamelen. Het gesprek blijft hoe dan ook bij de bot.
  const signalen = new Set<Signaal>();
  if (uit.signaal && SIGNALEN.includes(uit.signaal)) signalen.add(uit.signaal);
  if (uit.overdracht) signalen.add(uit.overdracht === 'klacht' || uit.overdracht === 'emotie' ? 'klacht' : 'twijfel');
  if (!(uit.confidence >= CONFIDENCE_DREMPEL)) signalen.add('twijfel');

  // Nooit een leeg bericht: vraag dan gewoon naar wat er nog ontbreekt.
  const antwoord = uit.antwoord?.trim() || terugvalVraag(kwalificatie, prijzen);

  // Filter draait zodra er genoeg bekend is — niet pas aan het eind.
  const oordeel = beoordeel(kwalificatie, profiel);
  if (!oordeel.past) {
    return { soort: 'afwijzing', tekst: oordeel.nettetekst, reden: oordeel.reden };
  }

  // Prijsindicatie, één keer per aanvraag, zodra alles bekend is.
  let prijs: Prijsindicatie | undefined;
  let extraWerk: string[] | undefined;
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

    if (u.soort === 'indicatie') prijs = u.indicatie;
    if (u.soort === 'monteur' && u.basis) {
      // Werk zonder uurnorm: prijs voor de montage geven, het extra werk
      // komt er apart bij in de offerte. De bot gaat gewoon door.
      prijs = u.basis;
      extraWerk = (kwalificatie.werk?.overig ?? []).filter((o) => o.trim());
      signalen.add('extra_werk');
    }
  }

  const metPrijs = (tekst: string) => {
    if (!prijs) return tekst;
    const extra = extraWerk?.length
      ? `\n\n${hoofdletter(extraWerk.join(', '))} komt daar nog bij. Dat rekent ${profiel.aanspreeknaam || 'de monteur'} apart uit en staat in de offerte.`
      : '';
    return `${prijsTekst(prijs)}${extra}\n\n${tekst}`.trim();
  };

  const sig = [...signalen];

  // Nog niet compleet: doorvragen.
  if (!isCompleet(kwalificatie, prijzen)) {
    return { soort: 'antwoord', tekst: metPrijs(antwoord), kwalificatie, prijs, signalen: sig, extraWerk };
  }

  // Een bezwaar of vraag na de prijs eerst beantwoorden, niet meteen data sturen.
  if (signalen.has('prijsbezwaar') || signalen.has('klacht') || signalen.has('wil_monteur')) {
    return { soort: 'antwoord', tekst: metPrijs(antwoord), kwalificatie, prijs, signalen: sig, extraWerk };
  }

  // Compleet en passend: agenda raadplegen.
  const plan = await zoekMomenten(kwalificatie, profiel, deps, {
    prijsFlow: prijzen && kwalificatie.type_klus === 'montage',
    dagenMax: prijs?.dagen_max ?? ctx.prijsGegeven?.dagen_max,
  });

  if (plan.slots.length === 0) {
    return {
      soort: 'overdracht',
      reden: 'buiten_regels',
      samenvatting:
        `Klant is akkoord om in te plannen, maar er is geen vrij ${plan.soort}-moment binnen acht weken. ` +
        vatSamen({ ...ctx, kwalificatie }, bericht, 'buiten_regels'),
      concept: prijs ? prijsTekst(prijs) : undefined,
      kwalificatie,
    };
  }

  return {
    soort: 'voorstel',
    tekst: metPrijs(formuleerVoorstel(plan.slots)),
    slots: plan.slots,
    vervalt_op: vervaltOp(),
    kwalificatie,
    prijs,
    signalen: sig,
    extraWerk,
  };
}

/**
 * Vrije momenten zoeken: eerst vier weken vooruit, dan acht.
 * `vanaf` overschrijft het begin (bijv. "geen van deze past, liever later").
 */
export async function zoekMomenten(
  kwalificatie: Kwalificatie,
  profiel: MonteurProfiel & PlannerProfiel,
  deps: Pick<Afhankelijkheden, 'bezetting'>,
  opties: { prijsFlow: boolean; dagenMax?: number; vanaf?: Date },
): Promise<{ soort: 'inmeting' | 'montage'; slots: Slot[] }> {
  const soort: 'inmeting' | 'montage' = opties.prijsFlow
    ? kwalificatie.ingemeten === false ? 'inmeting' : 'montage'
    : kwalificatie.keuken_geleverd === true ? 'montage' : 'inmeting';

  // De duur van de montage volgt uit de prijsberekening; de buffer zit in de dagen.
  const planProfiel = opties.dagenMax ? { ...profiel, montage_duur_dagdelen: opties.dagenMax * 2 } : profiel;

  // Niet plannen vóór de keuken er is: vroegst de dag na levering.
  const nu = new Date();
  const naLevering = kwalificatie.leverdatum ? new Date(`${kwalificatie.leverdatum}T00:00:00`) : null;
  naLevering?.setDate(naLevering.getDate() + 1);
  let vanaf = soort === 'montage' && naLevering && +naLevering > +nu ? naLevering : nu;
  if (opties.vanaf && +opties.vanaf > +vanaf) vanaf = opties.vanaf;

  for (const dagen of [28, 56]) {
    const bezet = await deps.bezetting(vanaf, dagen);
    const slots = vrijeSlots({ vanaf, dagen, soort, profiel: planProfiel, bezet, klantPc4: kwalificatie.pc4 });
    if (slots.length) return { soort, slots };
  }
  return { soort, slots: [] };
}

// ------------------------------------------------------------------ hulpjes

function hoofdletter(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function terugvalVraag(k: Kwalificatie, prijzen: boolean): string {
  const v = volgendVeld({ type_klus: 'montage', ...k }, prijzen);
  if (!v) return 'Dank u. Ik zoek een paar momenten voor u uit.';
  if (v === 'werk') {
    return 'Kunt u de onderdelenlijst of orderbevestiging van de keuken sturen, als foto of PDF? Dan kan ik u een prijs en een montagedatum geven.';
  }
  return `Kunt u mij nog laten weten: ${veldUitleg(v)}?`;
}

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
  // "onbekend" = de klant weet het niet of de keuken staat er al: plan vanaf vandaag.
  if (uit.leverdatum === 'onbekend') uit.leverdatum = new Date().toISOString().slice(0, 10);
  if (uit.leverdatum && !/^\d{4}-\d{2}-\d{2}$/.test(uit.leverdatum)) delete uit.leverdatum;
  return uit;
}

export function vatSamen(ctx: LeadContext, bericht: string, reden: string): string {
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
