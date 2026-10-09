/**
 * De runner — het proces dat op de VPS draait.
 *
 * Knoopt alles aan elkaar: WhatsApp binnen, orchestrator beslist, agenda
 * bepaalt wat vrij is, database onthoudt, monteur krijgt bericht.
 *
 * MEELEESMODUS
 * Staat MEELEZEN=true in .env, dan gaat GEEN enkel bericht naar de klant.
 * Alles wat de bot zou hebben gezegd komt als melding bij de monteur. Dat is
 * de stand waarin je begint: een week lang kijken wat hij zou doen, zonder
 * één klant te riskeren.
 */

import { createClient } from '@supabase/supabase-js';
import { baileysTransport, type InkomendBericht } from './transport.js';
import { verwerkBericht, zoekMomenten, type Besluit, type LeadContext, type Signaal } from './orchestrator.js';
import { formuleerVoorstel, vervaltOp } from './planner.js';
import { CONFIDENCE_DREMPEL, systeemprompt, type Kwalificatie, type PrijsContext } from './kwalificatie.js';
import { keuzePrompt, leesKeuze, omschrijfSlot, snelleKeuze, type KeuzeUitkomst } from './keuze.js';
import { bundelNaarTekst, type BundelMedia } from './media.js';
import { bestandenVan, bewaarBestand, leesBytes, markeerVerstuurd, ruimBestandenOp, wisBestanden } from './bestanden.js';
import { duidBericht } from './model.js';
import { prijsOpbouw, prijzenActief, type PrijsProfiel, type Prijsindicatie, type Uurnormen } from './prijs.js';
import { bezetting as agendaBezetting, vastleggen, type GoogleKoppeling } from './agenda.js';
import { overnachtingsAdvies, reis, samenvatting, type ReisProfiel } from './reiskosten.js';
import type { Bezetting } from './planner.js';
import {
  NIEUW_GESPREK_TEKST, RESET_TEKST, UPDATE_TEKST,
  huidigeVersie, isReset, laatstGemeld, leesbaarNummer, leesTestnummers, normaliseerNummer, onthoudGemeld,
} from './testers.js';

const env = (naam: string, verplicht = true): string => {
  const v = process.env[naam];
  if (!v && verplicht) {
    console.error(`Ontbrekende instelling in .env: ${naam}`);
    process.exit(1);
  }
  return v ?? '';
};

const MEELEZEN = (process.env.MEELEZEN ?? 'true').toLowerCase() !== 'false';
/**
 * Jouw eigen nummer, 31…. Meldingen van de runner zelf (updates) komen hier,
 * en ook seintjes van een monteur die in de webinterface nog geen eigen
 * nummer heeft ingevuld.
 */
const MONTEUR_WHATSAPP = env('MONTEUR_WHATSAPP', false);
const WHATSAPP_NUMMER = env('WHATSAPP_NUMMER');       // het wegwerpnummer
const AUTH_DIR = process.env.AUTH_DIR ?? '/opt/keukenbot/auth';
/**
 * Klanten sturen vaak meerdere berichten of bestanden achter elkaar
 * (onderdelenlijst, plattegrond, "en de leverdatum is ..."). De bot wacht
 * zoveel seconden na het laatste bericht en beantwoordt ze dan in één keer.
 */
const BUNDEL_MS = Number(process.env.BUNDEL_SECONDEN ?? 15) * 1000;
/** Vrienden die de bot stresstesten (zie testers.ts). */
const TESTNUMMERS = leesTestnummers(process.env.TESTNUMMERS);
const isTester = (nummer: string) => TESTNUMMERS.has(normaliseerNummer(nummer));
/** Welke versie de testers het laatst een updatebericht over kregen. */
const VERSIE_BESTAND = process.env.VERSIE_BESTAND ?? '/opt/keukenbot/laatste-testmelding.txt';

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

/**
 * Google Agenda per monteur.
 *
 * Koppelt een monteur zijn agenda in de webinterface, dan staat het token in
 * google_koppelingen (alleen leesbaar met de service role) en hoort het bij de
 * web-client (GOOGLE_WEB_CLIENT_ID). Zonder die rij valt de runner terug op
 * de koppeling uit .env (koppel-agenda.mjs) — zo blijft Rotterdam
 * Keukenmontage werken zoals voorheen.
 */
const envGoogle: GoogleKoppeling | null = process.env.GOOGLE_REFRESH_TOKEN
  ? {
      clientId: env('GOOGLE_CLIENT_ID'),
      clientSecret: env('GOOGLE_CLIENT_SECRET'),
      refreshToken: env('GOOGLE_REFRESH_TOKEN'),
      agendaId: process.env.GOOGLE_AGENDA_ID ?? 'primary',
    }
  : null;
const WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
const WEB_CLIENT_SECRET = process.env.GOOGLE_WEB_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '';

interface MonteurInfo {
  actief: boolean;
  /** waar seintjes heen gaan (31…), of leeg */
  meldnummer: string;
  google: GoogleKoppeling | null;
}

/** Een minuut onthouden: een wijziging in de webinterface is zo snel genoeg zichtbaar. */
const infoCache = new Map<string, { info: MonteurInfo; tot: number }>();

async function monteurInfo(monteurId: string): Promise<MonteurInfo> {
  const c = infoCache.get(monteurId);
  if (c && c.tot > Date.now()) return c.info;

  const [{ data: m }, { data: g }] = await Promise.all([
    db.from('monteurs').select('actief, telefoon').eq('id', monteurId).maybeSingle(),
    db.from('google_koppelingen').select('refresh_token, agenda_id').eq('monteur_id', monteurId).maybeSingle(),
  ]);

  const info: MonteurInfo = {
    actief: m?.actief !== false,
    meldnummer: m?.telefoon || MONTEUR_WHATSAPP,
    google: g?.refresh_token && WEB_CLIENT_ID
      ? { clientId: WEB_CLIENT_ID, clientSecret: WEB_CLIENT_SECRET, refreshToken: g.refresh_token, agendaId: g.agenda_id ?? 'primary' }
      : envGoogle,
  };
  infoCache.set(monteurId, { info, tot: Date.now() + 60_000 });
  return info;
}

async function googleVan(monteurId: string): Promise<GoogleKoppeling> {
  const g = (await monteurInfo(monteurId)).google;
  if (!g) throw new Error('Geen Google Agenda gekoppeld. Koppel hem in de webinterface onder Koppelingen.');
  return g;
}

const transport = baileysTransport({
  authDir: AUTH_DIR,
  eigenNummer: WHATSAPP_NUMMER,
});

// ---------------------------------------------------------------- opstarten

async function start() {
  console.log(`Keukenbot start — ${MEELEZEN ? 'MEELEESMODUS (klant krijgt niets)' : 'LIVE'}`);
  if (TESTNUMMERS.size) console.log(`${TESTNUMMERS.size} testnummer(s) actief`);

  await transport.start(ontvang);

  // Niet afwachten: het updatebericht wacht zelf op de verbinding.
  meldUpdate().catch((e) => console.error('updatebericht mislukt:', String(e)));

  // Verlopen reserveringen opruimen: elk kwartier.
  setInterval(ruimOp, 15 * 60 * 1000);
  await ruimOp();
}

// ------------------------------------------------------- binnenkomst

const wachtrij = new Map<string, { b: InkomendBericht; teksten: string[]; media: BundelMedia[]; timer: NodeJS.Timeout }>();

/**
 * Elk bericht komt hier binnen. Foto's en bestanden worden meteen gedownload
 * en bewaard; het uitlezen gebeurt pas als de klant even niets meer stuurt,
 * en dan voor de hele bundel in één keer (08-10-2026). Zo telt het model een
 * lijst van drie foto's als één lijst.
 */
async function ontvang(b: InkomendBericht) {
  // Staat het nummer van de monteur zelf in TESTNUMMERS, dan speelt hij klant
  // (08-10-2026: Maarten heeft alleen zijn eigen nummer en het botnummer).
  if (MONTEUR_WHATSAPP && b.vanNummer === MONTEUR_WHATSAPP && !isTester(b.vanNummer)) return;

  const sleutel = `${b.kanaalSleutel}|${b.vanNummer}`;

  // Een tester stuurt 'reset': gesprek wissen, niets naar het model.
  if (!b.media && isReset(b.tekst) && isTester(b.vanNummer)) {
    const wachtend = wachtrij.get(sleutel);
    if (wachtend) clearTimeout(wachtend.timer);
    wachtrij.delete(sleutel);
    await wisGesprek(b.vanNummer);
    if (!MEELEZEN) await transport.stuur(b.vanNummer, RESET_TEKST);
    console.log(`testgesprek ${b.vanNummer} gewist (reset)`);
    return;
  }

  const bestaand = wachtrij.get(sleutel);
  if (bestaand) clearTimeout(bestaand.timer);

  const item = bestaand ?? { b, teksten: [], media: [], timer: undefined as unknown as NodeJS.Timeout };
  if (b.media) item.media.push(mediaBinnen(b));
  else if (b.tekst.trim()) item.teksten.push(b.tekst);

  item.timer = setTimeout(async () => {
    wachtrij.delete(sleutel);
    try {
      const uitgelezen = await bundelNaarTekst(item.media);
      const teksten = [...item.teksten, uitgelezen].filter((t) => t.trim());
      if (!teksten.length) return;
      await behandel({ ...item.b, tekst: teksten.join('\n\n'), media: undefined });
    } catch (e) {
      console.error('verwerken mislukt:', String(e));
    }
  }, BUNDEL_MS);
  wachtrij.set(sleutel, item);
}

/**
 * Een foto of bestand: meteen downloaden (één keer) en een kopie bewaren voor
 * de monteur. Uitlezen gebeurt later, samen met de rest van de bundel.
 */
function mediaBinnen(b: InkomendBericht): BundelMedia {
  const media = b.media!;
  const bytes = media.download();
  bytes.then(
    (buf) => bewaarBestand(b.vanNummer, buf, media),
    (e) => console.error('media downloaden mislukt:', String(e)),
  );
  return { media: { ...media, download: () => bytes }, bijschrift: b.tekst };
}

// ------------------------------------------------------------- per bericht

async function behandel(b: InkomendBericht) {
  const kanaal = await db
    .from('kanalen')
    .select('id, monteur_id')
    .eq('soort', 'whatsapp')
    .eq('externe_id', b.kanaalSleutel)
    .eq('actief', true)
    .maybeSingle();

  if (!kanaal.data) {
    console.warn(`Bericht op onbekend kanaal ${b.kanaalSleutel}, genegeerd`);
    return;
  }

  const monteurId = kanaal.data.monteur_id;
  const info = await monteurInfo(monteurId);

  // Berichten van de monteur zelf nooit als klantaanvraag behandelen,
  // behalve als zijn nummer in TESTNUMMERS staat: dan test hij als klant.
  if ((b.vanNummer === MONTEUR_WHATSAPP || b.vanNummer === info.meldnummer) && !isTester(b.vanNummer)) return;

  // Gepauzeerd in de beheerpagina: de bot antwoordt niet.
  if (!info.actief) {
    console.warn(`monteur ${monteurId} staat op pauze; bericht van ${b.vanNummer} niet beantwoord`);
    return;
  }

  const { data: profielRij } = await db
    .from('monteur_profielen')
    .select('*, monteurs(bedrijfsnaam, telefoon)')
    .eq('monteur_id', monteurId)
    .single();

  if (!profielRij) return;
  const profiel = {
    ...profielRij,
    bedrijfsnaam: (profielRij as any).monteurs?.bedrijfsnaam ?? null,
    klant_telefoon: (profielRij as any).telefoon_voor_klanten
      ? leesbaarNummer((profielRij as any).monteurs?.telefoon)
      : null,
  };

  let lead = await vindOfMaakLead(monteurId, kanaal.data.id, b.vanNummer);

  // Een tester na inplannen of overdracht: niet zwijgen, maar opnieuw
  // beginnen. Zo kan hij meteen het volgende scenario spelen.
  if ((lead.status === 'overgedragen' || lead.status === 'ingepland') && isTester(b.vanNummer)) {
    await wisGesprek(b.vanNummer);
    if (!MEELEZEN) await transport.stuur(b.vanNummer, NIEUW_GESPREK_TEKST);
    lead = await vindOfMaakLead(monteurId, kanaal.data.id, b.vanNummer);
  }

  // Overgedragen of ingepland: de bot zwijgt, de monteur krijgt het bericht.
  if (lead.status === 'overgedragen' || lead.status === 'ingepland') {
    await bewaarKlantbericht(lead.id, b.tekst);
    await naarMonteur(
      monteurId,
      `${lead.status === 'ingepland' ? 'Ingeplande klant' : 'Overgedragen gesprek'} ` +
        `${b.vanNummer}${lead.klant_naam ? ` (${lead.klant_naam})` : ''} schrijft — de bot antwoordt niet:\n\n` +
        kortBestandsinhoud(b.tekst).slice(0, 3000),
    );
    await bestandenNaarMonteur(monteurId, lead);
    return;
  }

  // Er staan nog momenten open waaruit de klant kan kiezen.
  if (lead.status === 'gekwalificeerd') {
    const open = await openVoorstel(lead.id);
    if (open.length) {
      await behandelKeuze(b, lead, profiel, open, monteurId);
      return;
    }
  }

  // De historie zonder het bericht van nu: dat gaat apart naar het model.
  const hist = await historie(lead.id);

  await db.from('berichten').insert({
    lead_id: lead.id,
    richting: 'in',
    afzender: 'klant',
    tekst: b.tekst,
  });

  const ctx: LeadContext = {
    kwalificatie: pakKwalificatie(lead),
    vervolgvragen: await telBotberichten(lead.id),
    historie: hist,
    prijsGegeven: prijsGegevenVan(lead),
  };

  const prijsProfiel = maakPrijsProfiel(profiel);

  const besluit = await verwerkBericht(b.tekst, ctx, profiel, {
    duidBericht: duidBericht,
    bezetting: (vanaf, dagen) => bezettingVoor(monteurId, vanaf, dagen),
  }, prijsProfiel);

  // Wat er in dit bericht bekend werd, altijd bewaren — ook bij een overdracht.
  if ('kwalificatie' in besluit && besluit.kwalificatie) {
    await db.from('leads').update({
      ...naarLead(besluit.kwalificatie),
      laatste_bericht_op: new Date().toISOString(),
    }).eq('id', lead.id);
  }

  // Prijs die nu voor het eerst genoemd wordt vastleggen, zodat hij niet
  // opnieuw berekend wordt en de bot hem later kan herhalen.
  if ((besluit.soort === 'antwoord' || besluit.soort === 'voorstel') && besluit.prijs) {
    await bewaarPrijs(lead.id, besluit.prijs, besluit.kwalificatie);
    await naarMonteur(
      monteurId,
      `Prijsindicatie gegeven aan ${b.vanNummer}\n${prijsOpbouw(besluit.prijs, prijsProfiel!.uurtarief)}`,
    );
  }

  switch (besluit.soort) {
    case 'antwoord': {
      await db.from('leads').update({ status: 'kwalificeren' }).eq('id', lead.id);
      await naarKlant(b.vanNummer, besluit.tekst, lead.id, monteurId, besluit.prijs ? 'prijsindicatie' : 'vervolgvraag');
      await seintjes(monteurId, lead, b, besluit.signalen, besluit.tekst, besluit.extraWerk);
      break;
    }

    case 'afwijzing': {
      await db.from('leads').update({
        status: 'afgewezen',
        afwijsreden: besluit.reden,
      }).eq('id', lead.id);
      await naarKlant(b.vanNummer, besluit.tekst, lead.id, monteurId, 'afwijzing');
      await naarMonteur(
      monteurId,
        `Aanvraag afgewezen (${besluit.reden})\nvan ${b.vanNummer}\n"${b.tekst}"`,
      );
      break;
    }

    case 'voorstel': {
      const dagen = besluit.slots[0]?.dagen ?? 1;
      const kosten = berekenReis({ ...lead, ...naarLead(besluit.kwalificatie) }, profiel);

      await db.from('afspraken').insert(
        besluit.slots.map((s) => ({
          monteur_id: monteurId,
          lead_id: lead.id,
          soort: s.soort,
          start_op: s.start.toISOString(),
          eind_op: s.eind.toISOString(),
          status: 'voorlopig',
          vervalt_op: besluit.vervalt_op.toISOString(),
        })),
      );

      await db.from('leads').update({
        status: 'gekwalificeerd',
        afstand_km: kosten?.reis.afstandKm ?? null,
        rijtijd_min: kosten?.reis.rijtijdMin ?? null,
        reiskosten: kosten ? kosten.reis.totaal * dagen : null,
      }).eq('id', lead.id);

      await naarKlant(b.vanNummer, besluit.tekst, lead.id, monteurId, 'slotvoorstel');
      await seintjes(monteurId, lead, b, besluit.signalen, besluit.tekst, besluit.extraWerk);
      await naarMonteur(monteurId, meldingIngepland({ ...lead, ...naarLead(besluit.kwalificatie) }, besluit, kosten, dagen));
      break;
    }

    case 'overdracht': {
      await draagOver(
        lead.id, monteurId, b.vanNummer, profiel, besluit.reden, besluit.samenvatting, besluit.concept,
        besluit.klanttekst || undefined,
      );
      break;
    }
  }
}

/**
 * Overdracht aan de monteur. Vanaf nu zwijgt de bot in dit gesprek; nieuwe
 * berichten van de klant gaan rechtstreeks door naar de monteur.
 */
async function draagOver(
  leadId: string,
  monteurId: string,
  nummer: string,
  profiel: any,
  reden: string,
  samenvatting: string,
  concept?: string,
  klanttekst?: string,
) {
  await db.from('leads').update({ status: 'overgedragen' }).eq('id', leadId);
  await db.from('review_items').insert({
    monteur_id: monteurId,
    lead_id: leadId,
    reden,
    samenvatting,
    voorgesteld_antwoord: concept ?? null,
  });
  const tekst =
    klanttekst ?? `Ik leg dit even voor aan ${profiel.aanspreeknaam || 'de monteur'}, hij reageert vandaag zelf.`;
  if (!MEELEZEN) await transport.stuur(nummer, tekst);
  await db.from('berichten').insert({ lead_id: leadId, richting: 'uit', afzender: 'bot', tekst });

  await naarMonteur(
    monteurId,
    `Overdracht (${reden})\nvan ${nummer}\n${kortBestandsinhoud(samenvatting, '')}` +
      (concept ? `\n\nVoorstel antwoord:\n${concept}` : '') +
      `\n\n${await gesprekVoorMonteur(leadId)}` +
      `\n\nDe bot antwoordt deze klant niet meer; reageer zelf vanaf het botnummer.`,
  );
  const { data: lead } = await db.from('leads').select('id, klant_telefoon, aangemaakt_op').eq('id', leadId).maybeSingle();
  if (lead) await bestandenNaarMonteur(monteurId, lead);
}

// ------------------------------------------------------- keuze uit voorstel

async function openVoorstel(leadId: string) {
  const { data } = await db
    .from('afspraken')
    .select('*')
    .eq('lead_id', leadId)
    .eq('status', 'voorlopig')
    .gt('vervalt_op', new Date().toISOString())
    .order('start_op', { ascending: true });
  return data ?? [];
}

async function behandelKeuze(b: InkomendBericht, lead: any, profiel: any, open: any[], monteurId: string) {
  const hist = await historie(lead.id);
  await bewaarKlantbericht(lead.id, b.tekst);

  const slots = open.map((a) => ({
    soort: a.soort as 'inmeting' | 'montage' | 'klusje',
    start: new Date(a.start_op),
    dagen: a.soort === 'montage' ? werkdagenVan(lead) : undefined,
  }));

  let uit: KeuzeUitkomst;
  const snel = snelleKeuze(b.tekst, open.length);
  if (snel) {
    uit = { keuze: snel, geen_past: false, antwoord: '', confidence: 1 };
  } else {
    const prijsCtx: PrijsContext | null = maakPrijsProfiel(profiel) ? { gegeven: prijsGegevenVan(lead) } : null;
    const systeem = systeemprompt(profiel, prijsCtx) + '\n\n' + keuzePrompt(slots);
    uit = leesKeuze(await duidBericht(systeem, hist, b.tekst), open.length);
  }

  if (uit.keuze) {
    await bevestig(b, lead, profiel, open[uit.keuze - 1], monteurId);
    return;
  }

  // Geen van de momenten past: zelf nieuwe zoeken, later dan de vorige.
  if (uit.geen_past) {
    await db.from('afspraken').update({ status: 'geannuleerd' })
      .eq('lead_id', lead.id).eq('status', 'voorlopig');

    const naLaatste = new Date(open[open.length - 1].start_op);
    naLaatste.setDate(naLaatste.getDate() + 1);
    const vanaf = uit.vanaf && +uit.vanaf > Date.now() ? uit.vanaf : naLaatste;

    const kwal = pakKwalificatie(lead);
    const plan = await zoekMomenten(kwal, profiel, {
      bezetting: (v, d) => bezettingVoor(monteurId, v, d),
    }, {
      prijsFlow: Boolean(maakPrijsProfiel(profiel)) && kwal.type_klus === 'montage',
      dagenMax: werkdagenVan(lead),
      vanaf,
    });

    if (!plan.slots.length) {
      await draagOver(
        lead.id, monteurId, b.vanNummer, profiel, 'buiten_regels',
        `Klant wil inplannen, maar vanaf ${vanaf.toISOString().slice(0, 10)} is acht weken lang niets vrij.\nKlant: "${b.tekst.slice(0, 500)}"`,
        undefined,
        `Ik heb op korte termijn geen ruimte gevonden. ${profiel.aanspreeknaam || 'De monteur'} neemt vandaag contact met u op om een datum te prikken.`,
      );
      return;
    }

    await db.from('afspraken').insert(plan.slots.map((s) => ({
      monteur_id: monteurId,
      lead_id: lead.id,
      soort: s.soort,
      start_op: s.start.toISOString(),
      eind_op: s.eind.toISOString(),
      status: 'voorlopig',
      vervalt_op: vervaltOp().toISOString(),
    })));
    const inleiding = uit.antwoord.trim() ? `${uit.antwoord.trim()}\n\n` : '';
    await naarKlant(b.vanNummer, inleiding + formuleerVoorstel(plan.slots), lead.id, monteurId, 'slotvoorstel');
    return;
  }

  // Kan de klant het bedrag niet betalen: reserveringen vrijgeven en naar de monteur.
  if (uit.signaal === 'budget') {
    await db.from('afspraken').update({ status: 'geannuleerd' }).eq('lead_id', lead.id).eq('status', 'voorlopig');
    await draagOver(
      lead.id, monteurId, b.vanNummer, profiel, 'prijsvraag',
      `Klant kan het bedrag niet betalen (bij het kiezen van een moment). Laatste bericht: "${b.tekst.slice(0, 500)}"`,
      undefined,
      uit.antwoord.trim() || undefined,
    );
    return;
  }

  // Een vraag tussendoor: zelf beantwoorden. Twijfel = seintje, geen overdracht.
  const tekst = uit.antwoord.trim() || 'Welk moment past u het beste? Een nummer sturen is genoeg.';
  await naarKlant(b.vanNummer, tekst, lead.id, monteurId, 'vervolgvraag');
  const sig: Signaal[] = [];
  if (uit.signaal) sig.push(uit.signaal as Signaal);
  if (uit.confidence < CONFIDENCE_DREMPEL) sig.push('twijfel');
  await seintjes(monteurId, lead, b, sig, tekst);
}

const SEINTJE_UITLEG: Record<Signaal, string> = {
  prijsbezwaar: 'Prijsbezwaar. De bot heeft onderbouwd en gezegd dat de klant het bedrag met jou kan bespreken.',
  prijsvraag: 'Klant vraagt naar de prijs.',
  klacht: 'Klacht of boze klant. De bot heeft gezegd dat jij het bericht krijgt.',
  wil_monteur: 'Klant vraagt naar jou. De bot heeft je nummer gegeven (als dat aan staat) of gezegd dat je contact opneemt zodra de datum staat.',
  twijfel: 'De bot twijfelde over zijn antwoord. Kijk even mee.',
  extra_werk: 'Werk zonder vaste prijs; de bot heeft gezegd dat jij het apart in de offerte zet.',
  budget: 'Klant kan het bedrag niet betalen. Het gesprek is aan jou overgedragen.',
};

/**
 * Seintje aan de monteur. Het gesprek blijft bij de bot, dus kort: alleen het
 * laatste bericht. Het volledige gesprek en de bestanden komen pas bij een
 * overdracht of inplanning.
 */
async function seintjes(monteurId: string, lead: any, b: InkomendBericht, signalen: Signaal[], antwoord: string, extraWerk?: string[]) {
  if (!signalen.length) return;
  const regels = [...new Set(signalen)].map((s) =>
    s === 'extra_werk' && extraWerk?.length ? `${SEINTJE_UITLEG[s]} (${extraWerk.join(', ')})` : SEINTJE_UITLEG[s] ?? s,
  );
  await naarMonteur(
    monteurId,
    `Seintje — ${b.vanNummer}${lead.klant_naam ? ` (${lead.klant_naam})` : ''}\n${regels.join('\n')}\n\n` +
      `Klant: "${kortBestandsinhoud(b.tekst, '').slice(0, 400)}"\n\nBot: "${antwoord.slice(0, 400)}"` +
      `\n\nDe bot praat verder; je hoeft niets te doen.`,
  );
}

/** Uitgelezen bestandsinhoud inkorten tot de kopregel: het origineel gaat als bijlage mee. */
function kortBestandsinhoud(tekst: string, achter = ' (bijlage hieronder)'): string {
  return tekst
    // Uitgelezen inhoud loopt tot [einde bestand]; oudere berichten hebben die
    // markering niet, daar loopt hij tot het volgende bestand of het einde.
    .replace(/\n\[inhoud van (het bestand|de bestanden), automatisch uitgelezen[^\]]*\][\s\S]*?(\n\[einde bestand\]|(?=\n\n\[klant stuurde)|$)/g, achter)
    .replace(/\n\[(uitlezen (van [^\]]* )?mislukt|bestandstype|een bestand kon niet|[^\]]* is te groot om uit te lezen)[^\]]*\]/g, achter);
}

/** Het hele gesprek als leesbare tekst, voor een melding aan de monteur. */
async function gesprekVoorMonteur(leadId: string): Promise<string> {
  const { data } = await db
    .from('berichten')
    .select('afzender, tekst')
    .eq('lead_id', leadId)
    .order('verzonden_op', { ascending: true });
  const wie = { klant: 'Klant', bot: 'Bot', monteur: 'Jij' } as Record<string, string>;
  const regels = (data ?? []).map((r: any) => `${wie[r.afzender] ?? r.afzender}: ${kortBestandsinhoud(String(r.tekst ?? '')).trim()}`);

  // WhatsApp kan lange berichten aan, maar leesbaar moet het blijven:
  // bij een heel lang gesprek vallen de oudste berichten weg.
  const MAX = 12_000;
  let weg = 0;
  while (regels.length > 1 && regels.join('\n\n').length > MAX) {
    regels.shift();
    weg++;
  }
  return `Volledig gesprek:\n` + (weg ? `(… ${weg} eerdere berichten weggelaten)\n\n` : '\n') + regels.join('\n\n');
}

/** De foto's en bestanden van de klant die de monteur nog niet heeft. */
async function bestandenNaarMonteur(monteurId: string, lead: any) {
  try {
    const nummer = (await monteurInfo(monteurId)).meldnummer;
    if (!nummer) return;
    const sinds = lead.aangemaakt_op ? new Date(lead.aangemaakt_op) : undefined;
    const nieuw = bestandenVan(lead.klant_telefoon, sinds, true);
    const gelukt: string[] = [];
    for (const [i, f] of nieuw.entries()) {
      try {
        await transport.stuurBestand(nummer, {
          bytes: leesBytes(lead.klant_telefoon, f),
          mime: f.mime,
          naam: f.naam,
          bijschrift: `Van klant ${lead.klant_telefoon} (${i + 1}/${nieuw.length})`,
        });
        gelukt.push(f.id);
      } catch (e) {
        console.error(`bestand ${f.naam} naar monteur mislukt:`, String(e));
      }
    }
    markeerVerstuurd(lead.klant_telefoon, gelukt);
  } catch (e) {
    console.error('bestanden naar monteur mislukt:', String(e));
  }
}

/** De gekozen afspraak in Google zetten, de rest vrijgeven, iedereen inlichten. */
async function bevestig(b: InkomendBericht, lead: any, profiel: any, gekozen: any, monteurId: string) {
  const start = new Date(gekozen.start_op);
  const eind = new Date(gekozen.eind_op);
  const naam = profiel.aanspreeknaam || 'de monteur';
  const omschrijving = omschrijfSlot({ soort: gekozen.soort, start, dagen: werkdagenVan(lead) });

  let eventId: string | null = null;
  if (!MEELEZEN) {
    try {
      // Is het moment intussen in Google bezet geraakt (zelf iets ingepland)?
      const dagen = Math.ceil((+eind - +start) / 86_400_000) + 1;
      const bezet = await agendaBezetting(await googleVan(monteurId), start, dagen, []);
      if (bezet.some((x) => x.start < eind && x.eind > start)) {
        await draagOver(
          lead.id, monteurId, b.vanNummer, profiel, 'buiten_regels',
          `Klant koos ${omschrijving}, maar dat staat intussen bezet in de agenda.`,
          undefined,
          `Ik check het moment nog even met ${naam}, hij bevestigt het vandaag zelf.`,
        );
        return;
      }

      eventId = await vastleggen(await googleVan(monteurId), {
        soort: gekozen.soort,
        start,
        eind,
        klantNaam: lead.klant_naam ?? undefined,
        klantTelefoon: b.vanNummer,
        adres: lead.plaats ?? (lead.pc4 ? String(lead.pc4) : undefined),
        notitie: agendaNotitie(lead),
        test: isTester(b.vanNummer),
      });
    } catch (e) {
      console.error('vastleggen mislukt:', String(e));
      await draagOver(
        lead.id, monteurId, b.vanNummer, profiel, 'buiten_regels',
        `Klant koos ${omschrijving}, maar wegschrijven in Google Agenda mislukte: ${String(e)}`,
        undefined,
        `Ik check het moment nog even met ${naam}, hij bevestigt het vandaag zelf.`,
      );
      return;
    }
  }

  await db.from('afspraken').update({ status: 'bevestigd', google_event_id: eventId, vervalt_op: null })
    .eq('id', gekozen.id);
  await db.from('afspraken').update({ status: 'geannuleerd' })
    .eq('lead_id', lead.id).eq('status', 'voorlopig');
  await db.from('leads').update({ status: 'ingepland', laatste_bericht_op: new Date().toISOString() })
    .eq('id', lead.id);

  const duur =
    lead.dagen_min && lead.dagen_max ? ` en duurt ${lead.dagen_min} tot ${lead.dagen_max} werkdagen` : '';
  const tekst =
    gekozen.soort === 'montage'
      ? `Genoteerd: de montage begint ${omschrijfSlot({ soort: 'inmeting', start }).split(' om ')[0]}${duur}. ` +
        `${naam} neemt vooraf contact met u op over de laatste details. Wilt u het adres nog sturen?`
      : gekozen.soort === 'klusje'
      ? `Genoteerd: ${naam} komt ${omschrijfSlot({ soort: 'inmeting', start })} langs. Wilt u het adres nog sturen?`
      : `Genoteerd: ${naam} komt ${omschrijfSlot({ soort: 'inmeting', start })} inmeten. Wilt u het adres nog sturen?`;

  await naarKlant(b.vanNummer, tekst, lead.id, monteurId, 'bevestiging');
  await naarMonteur(
      monteurId,
    `Ingepland en aan jou overgedragen: ${gekozen.soort} ${omschrijving}\nklant ${b.vanNummer}${lead.klant_naam ? ` (${lead.klant_naam})` : ''}` +
      `\n${agendaNotitie(lead)}` +
      (eventId ? '\nStaat in je Google Agenda.' : MEELEZEN ? '\n(meeleesmodus: niet in Google gezet)' : '') +
      `\n\n${await gesprekVoorMonteur(lead.id)}`,
  );
  await bestandenNaarMonteur(monteurId, lead);
}

function agendaNotitie(lead: any): string {
  const w = lead.werk ?? {};
  const kasten = (w.onderkasten ?? 0) + (w.hangkasten ?? 0) + (w.hoge_kasten ?? 0);
  return [
    lead.pc4 ? `Postcode ${lead.pc4}${lead.plaats ? ` ${lead.plaats}` : ''}` : null,
    lead.verdieping != null ? `${lead.verdieping}e verdieping${lead.lift === false ? ', geen lift' : ''}` : null,
    kasten ? `${kasten} kasten${w.levering ? ` (${w.levering})` : ''}${lead.leverancier ? `, ${lead.leverancier}` : ''}` : null,
    lead.werkblad_door ? `Werkblad: ${lead.werkblad_door}` : null,
    lead.prijs_min ? `Indicatie € ${lead.prijs_min}–${lead.prijs_max} ${lead.prijs_incl_btw ? 'incl.' : 'excl.'} btw` : null,
  ].filter(Boolean).join('\n');
}

function werkdagenVan(lead: any): number | undefined {
  return lead.dagen_max ? Number(lead.dagen_max) : undefined;
}

function prijsGegevenVan(lead: any): PrijsContext['gegeven'] {
  if (!lead.prijs_gegeven_op) return undefined;
  return {
    min: Number(lead.prijs_min),
    max: Number(lead.prijs_max),
    incl_btw: Boolean(lead.prijs_incl_btw),
    dagen_min: Number(lead.dagen_min),
    dagen_max: Number(lead.dagen_max),
    posten: Array.isArray(lead.werk?._posten) ? lead.werk._posten : [],
  };
}

async function bewaarKlantbericht(leadId: string, tekst: string) {
  await db.from('berichten').insert({ lead_id: leadId, richting: 'in', afzender: 'klant', tekst });
  await db.from('leads').update({ laatste_bericht_op: new Date().toISOString() }).eq('id', leadId);
}

// ------------------------------------------------------------- uitgaand

/**
 * In meeleesmodus gaat er niets naar de klant; de monteur ziet wat de bot
 * gezegd zou hebben. Dat blijft wél in `berichten` staan, zodat het gesprek
 * logisch doorloopt als je later overschakelt.
 */
async function naarKlant(
  nummer: string,
  tekst: string,
  leadId: string,
  monteurId: string,
  soort: string,
) {
  if (MEELEZEN) {
    await naarMonteur(monteurId, `[meelezen · ${soort}] naar ${nummer}:\n\n${tekst}`);
  } else {
    await transport.stuur(nummer, tekst);
  }

  await db.from('berichten').insert({
    lead_id: leadId,
    richting: 'uit',
    afzender: 'bot',
    tekst,
  });
}

/** Melding aan de monteur via WhatsApp. monteurId null = aan jou als beheerder. */
async function naarMonteur(monteurId: string | null, tekst: string) {
  try {
    const nummer = monteurId ? (await monteurInfo(monteurId)).meldnummer : MONTEUR_WHATSAPP;
    if (!nummer) {
      console.warn(`geen meldnummer voor monteur ${monteurId}; melding niet verstuurd`);
      return;
    }
    await transport.stuur(nummer, tekst);
  } catch (e) {
    // De melding mag nooit het verwerken blokkeren.
    console.error('melding naar monteur mislukt:', String(e));
  }
}

function meldingIngepland(
  lead: any,
  besluit: Extract<Besluit, { soort: 'voorstel' }>,
  kosten: { reis: ReturnType<typeof reis>; profiel: ReisProfiel } | null,
  dagen: number,
): string {
  const fmt = new Intl.DateTimeFormat('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const regels = [
    `Aanvraag gekwalificeerd — ${besluit.slots[0].soort}`,
    lead.plaats || lead.pc4 ? `Locatie: ${lead.plaats ?? lead.pc4}` : null,
    lead.leverancier ? `Leverancier: ${lead.leverancier}` : null,
    lead.omvang ? `Omvang: ${lead.omvang}` : null,
    lead.installatiewerk?.length ? `Installatie: ${lead.installatiewerk.join(', ')}` : null,
    '',
    'Voorgesteld:',
    ...besluit.slots.map((s) => `  ${fmt.format(s.start)}`),
  ].filter((r) => r !== null);

  if (kosten) {
    regels.push('', samenvatting(kosten.reis, dagen));
    const advies = overnachtingsAdvies(kosten.reis, dagen, kosten.profiel.hotelRichtprijs);
    if (advies) regels.push('', advies);
  }

  return regels.join('\n');
}

// ------------------------------------------------------------- hulpjes

function berekenReis(lead: any, profiel: any) {
  if (!lead.pc4 || !profiel.vertrek_postcode) return null;

  const p: ReisProfiel = {
    vertrekPc4: Number(profiel.vertrek_postcode),
    kmTarief: Number(profiel.km_tarief),
    uurtarief: Number(profiel.uurtarief ?? 0),
    reisuurPercentage: Number(profiel.reisuur_percentage),
    gratisPc4: profiel.gratis_pc4 ?? [],
    hotelRichtprijs: Number(profiel.hotel_richtprijs ?? 90),
  };

  return { reis: reis(lead.pc4, p), profiel: p };
}

/**
 * Bezetting = wat er in Google staat, plus de eigen afspraken (die hebben een
 * postcode, wat Google niet teruggeeft) plus de nog geldige reserveringen.
 */
async function bezettingVoor(monteurId: string, vanaf: Date, dagen: number): Promise<Bezetting[]> {
  const tot = new Date(+vanaf + dagen * 24 * 60 * 60 * 1000);

  const { data } = await db
    .from('afspraken')
    .select('start_op, eind_op, leads(pc4)')
    .eq('monteur_id', monteurId)
    .in('status', ['voorlopig', 'bevestigd'])
    .gte('start_op', vanaf.toISOString())
    .lte('start_op', tot.toISOString());

  const eigen: Bezetting[] = (data ?? []).map((a: any) => ({
    start: new Date(a.start_op),
    eind: new Date(a.eind_op),
    pc4: a.leads?.pc4 ?? undefined,
  }));

  try {
    return await agendaBezetting(await googleVan(monteurId), vanaf, dagen, eigen);
  } catch (e) {
    // Zonder agenda liever niets voorstellen dan iets fouts: geef de eigen
    // afspraken terug én log luid, zodat je het merkt.
    console.error('AGENDA ONBEREIKBAAR:', String(e));
    await naarMonteur(monteurId, `Let op: de agenda is onbereikbaar. ${String(e)}`);
    return eigen;
  }
}

// ------------------------------------------------------------- testers

const OPEN_STATUSSEN = ['nieuw', 'kwalificeren', 'gekwalificeerd', 'overgedragen', 'ingepland'];

/**
 * Wist het lopende gesprek van een testnummer: de lead telt als verlopen en
 * de reserveringen vervallen. Een [TEST]-afspraak in Google blijft staan;
 * die gooi je zelf weg.
 */
async function wisGesprek(nummer: string) {
  const { data } = await db
    .from('leads')
    .select('id')
    .eq('klant_telefoon', nummer)
    .in('status', OPEN_STATUSSEN);
  wisBestanden(nummer);
  const ids = (data ?? []).map((l: any) => l.id);
  if (!ids.length) return;

  await db.from('afspraken').update({ status: 'geannuleerd' })
    .in('lead_id', ids).in('status', ['voorlopig', 'bevestigd']);
  await db.from('leads').update({ status: 'verlopen' }).in('id', ids);
}

/**
 * Na een update: elke tester een bericht en een schone lei. Alleen als de
 * code echt veranderd is sinds de vorige melding, dus niet na elke herstart.
 */
async function meldUpdate() {
  if (!TESTNUMMERS.size) return;

  const versie = huidigeVersie();
  if (!versie) {
    console.warn('versie onbekend, geen updatebericht naar testers');
    return;
  }
  if (laatstGemeld(VERSIE_BESTAND) === versie) return;
  if (MEELEZEN) {
    console.log('meeleesmodus: geen updatebericht naar testers');
    return;
  }

  await transport.verbonden();
  // Even laten bijkomen: vlak na het verbinden synchroniseert WhatsApp nog.
  await new Promise((r) => setTimeout(r, 10_000));

  let gelukt = 0;
  for (const nummer of TESTNUMMERS) {
    try {
      await wisGesprek(nummer);
      await transport.stuur(nummer, UPDATE_TEKST);
      gelukt++;
    } catch (e) {
      console.error(`updatebericht naar ${nummer} mislukt:`, String(e));
    }
  }

  // Ook bij een gedeeltelijke mislukking onthouden: liever één tester
  // gemist dan iedereen hetzelfde bericht bij elke herstart.
  onthoudGemeld(VERSIE_BESTAND, versie);
  console.log(`updatebericht versie ${versie} naar ${gelukt}/${TESTNUMMERS.size} testers`);
  await naarMonteur(
    null,
    `Nieuwe versie ${versie} draait. ${gelukt} van ${TESTNUMMERS.size} testers hebben het updatebericht gekregen; hun gesprekken zijn gewist.`,
  );
}

async function ruimOp() {
  ruimBestandenOp();
  const { data } = await db
    .from('afspraken')
    .update({ status: 'geannuleerd' })
    .eq('status', 'voorlopig')
    .lt('vervalt_op', new Date().toISOString())
    .select('id');

  if (data?.length) console.log(`${data.length} verlopen reservering(en) opgeruimd`);
}

async function vindOfMaakLead(monteurId: string, kanaalId: string, nummer: string) {
  const { data } = await db
    .from('leads')
    .select('*')
    .eq('monteur_id', monteurId)
    .eq('klant_telefoon', nummer)
    .in('status', ['nieuw', 'kwalificeren', 'gekwalificeerd', 'overgedragen', 'ingepland'])
    .order('aangemaakt_op', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Een overgedragen gesprek blijft twee weken bij de monteur, een ingeplande
  // klant twee maanden. Daarna is een nieuw bericht een nieuwe aanvraag.
  if (data) {
    const laatst = +new Date(data.laatste_bericht_op ?? data.aangemaakt_op);
    const dagen = (Date.now() - laatst) / 86_400_000;
    const grens = data.status === 'overgedragen' ? 14 : data.status === 'ingepland' ? 60 : Infinity;
    if (dagen <= grens) return data;
  }

  const { data: nieuw } = await db
    .from('leads')
    .insert({ monteur_id: monteurId, kanaal_id: kanaalId, klant_telefoon: nummer })
    .select()
    .single();

  return nieuw!;
}

/** Velden die 1-op-1 een kolom in `leads` zijn. */
const LEAD_VELDEN = [
  'pc4', 'plaats', 'type_klus', 'leverancier', 'omvang', 'installatiewerk',
  'keuken_geleverd', 'gewenste_periode', 'verdieping', 'lift', 'leverdatum',
  'werkblad_door', 'ingemeten', 'zakelijk', 'klant_naam', 'klusjes', 'klusje_uren', 'tweedehands',
] as const;

function pakKwalificatie(lead: any): Kwalificatie {
  const k: Record<string, unknown> = {};
  for (const v of LEAD_VELDEN) {
    if (lead[v] !== null && lead[v] !== undefined) k[v] = lead[v];
  }
  const { _posten, ...werk } = lead.werk ?? {};
  if (Object.keys(werk).length) k.werk = werk;
  return k as Kwalificatie;
}

function naarLead(k: Kwalificatie): Record<string, unknown> {
  const uit: Record<string, unknown> = {};
  for (const v of LEAD_VELDEN) {
    if (k[v] !== undefined) uit[v] = k[v];
  }
  if (k.werk) uit.werk = k.werk;
  return uit;
}

async function bewaarPrijs(leadId: string, p: Prijsindicatie, k: Kwalificatie) {
  await db.from('leads').update({
    prijs_min: p.min,
    prijs_max: p.max,
    prijs_incl_btw: p.incl_btw,
    dagen_min: p.dagen_min,
    dagen_max: p.dagen_max,
    prijs_uren: p.uren,
    prijs_gegeven_op: new Date().toISOString(),
    // De posten bewaren we bij het werk, zodat de bot ze later kan herhalen.
    werk: { ...(k.werk ?? {}), _posten: p.posten },
  }).eq('id', leadId);
}

/**
 * Prijzen alleen als de monteur ze zelf aanzet én een uurtarief én eigen
 * uurnormen heeft. Anders null: de bot noemt geen bedrag.
 */
function maakPrijsProfiel(profiel: any): PrijsProfiel | null {
  if (!prijzenActief(profiel)) return null;
  const reisProfiel = berekenReis({ pc4: 3000 }, profiel)?.profiel ?? null;
  return {
    uurtarief: Number(profiel.uurtarief),
    uurnormen: profiel.uurnormen as Uurnormen,
    reis: reisProfiel,
  };
}

async function telBotberichten(leadId: string): Promise<number> {
  const { count } = await db
    .from('berichten')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('afzender', 'bot');
  return count ?? 0;
}

async function historie(leadId: string) {
  const { data } = await db
    .from('berichten')
    .select('afzender, tekst')
    .eq('lead_id', leadId)
    .order('verzonden_op', { ascending: true })
    .limit(20);
  return (data ?? []) as { afzender: 'klant' | 'bot' | 'monteur'; tekst: string }[];
}

// ------------------------------------------------------------------ afsluiten

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    console.log('afsluiten...');
    await transport.stop();
    process.exit(0);
  });
}

start().catch((e) => {
  console.error('opstarten mislukt:', e);
  process.exit(1);
});
