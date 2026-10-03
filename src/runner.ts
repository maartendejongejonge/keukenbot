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
import { mediaNaarTekst } from './media.js';
import { duidBericht } from './model.js';
import { prijsOpbouw, prijzenActief, type PrijsProfiel, type Prijsindicatie, type Uurnormen } from './prijs.js';
import { bezetting as agendaBezetting, vastleggen, type GoogleKoppeling } from './agenda.js';
import { overnachtingsAdvies, reis, samenvatting, type ReisProfiel } from './reiskosten.js';
import type { Bezetting } from './planner.js';

const env = (naam: string, verplicht = true): string => {
  const v = process.env[naam];
  if (!v && verplicht) {
    console.error(`Ontbrekende instelling in .env: ${naam}`);
    process.exit(1);
  }
  return v ?? '';
};

const MEELEZEN = (process.env.MEELEZEN ?? 'true').toLowerCase() !== 'false';
const MONTEUR_WHATSAPP = env('MONTEUR_WHATSAPP');     // jouw eigen nummer, 31…
const WHATSAPP_NUMMER = env('WHATSAPP_NUMMER');       // het wegwerpnummer
const AUTH_DIR = process.env.AUTH_DIR ?? '/opt/keukenbot/auth';
/**
 * Klanten sturen vaak meerdere berichten of bestanden achter elkaar
 * (onderdelenlijst, plattegrond, "en de leverdatum is ..."). De bot wacht
 * zoveel seconden na het laatste bericht en beantwoordt ze dan in één keer.
 */
const BUNDEL_MS = Number(process.env.BUNDEL_SECONDEN ?? 15) * 1000;

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

const google: GoogleKoppeling = {
  clientId: env('GOOGLE_CLIENT_ID'),
  clientSecret: env('GOOGLE_CLIENT_SECRET'),
  refreshToken: env('GOOGLE_REFRESH_TOKEN'),
  agendaId: process.env.GOOGLE_AGENDA_ID ?? 'primary',
};

const transport = baileysTransport({
  authDir: AUTH_DIR,
  eigenNummer: WHATSAPP_NUMMER,
});

// ---------------------------------------------------------------- opstarten

async function start() {
  console.log(`Keukenbot start — ${MEELEZEN ? 'MEELEESMODUS (klant krijgt niets)' : 'LIVE'}`);

  await transport.start(ontvang);

  // Verlopen reserveringen opruimen: elk kwartier.
  setInterval(ruimOp, 15 * 60 * 1000);
  await ruimOp();
}

// ------------------------------------------------------- binnenkomst

const wachtrij = new Map<string, { b: InkomendBericht; delen: Promise<string>[]; timer: NodeJS.Timeout }>();

/**
 * Elk bericht komt hier binnen. Media worden meteen uitgelezen (parallel);
 * het antwoord volgt pas als de klant even niets meer stuurt.
 */
async function ontvang(b: InkomendBericht) {
  if (b.vanNummer === MONTEUR_WHATSAPP) return;

  const deel = b.media ? mediaNaarTekst(b.media, b.tekst) : Promise.resolve(b.tekst);
  const sleutel = `${b.kanaalSleutel}|${b.vanNummer}`;
  const bestaand = wachtrij.get(sleutel);
  if (bestaand) clearTimeout(bestaand.timer);

  const item = bestaand ?? { b, delen: [], timer: undefined as unknown as NodeJS.Timeout };
  item.delen.push(deel);
  item.timer = setTimeout(async () => {
    wachtrij.delete(sleutel);
    const teksten = (await Promise.all(item.delen)).filter((t) => t.trim());
    if (!teksten.length) return;
    try {
      await behandel({ ...item.b, tekst: teksten.join('\n\n'), media: undefined });
    } catch (e) {
      console.error('verwerken mislukt:', String(e));
    }
  }, BUNDEL_MS);
  wachtrij.set(sleutel, item);
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

  // Berichten van de monteur zelf nooit als klantaanvraag behandelen.
  if (b.vanNummer === MONTEUR_WHATSAPP) return;

  const { data: profielRij } = await db
    .from('monteur_profielen')
    .select('*, monteurs(bedrijfsnaam)')
    .eq('monteur_id', monteurId)
    .single();

  if (!profielRij) return;
  const profiel = { ...profielRij, bedrijfsnaam: (profielRij as any).monteurs?.bedrijfsnaam ?? null };

  const lead = await vindOfMaakLead(monteurId, kanaal.data.id, b.vanNummer);

  // Overgedragen of ingepland: de bot zwijgt, de monteur krijgt het bericht.
  if (lead.status === 'overgedragen' || lead.status === 'ingepland') {
    await bewaarKlantbericht(lead.id, b.tekst);
    await naarMonteur(
      `${lead.status === 'ingepland' ? 'Ingeplande klant' : 'Overgedragen gesprek'} ` +
        `${b.vanNummer}${lead.klant_naam ? ` (${lead.klant_naam})` : ''} schrijft — de bot antwoordt niet:\n\n` +
        b.tekst.slice(0, 1500),
    );
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
      `Prijsindicatie gegeven aan ${b.vanNummer}\n${prijsOpbouw(besluit.prijs, prijsProfiel!.uurtarief)}`,
    );
  }

  switch (besluit.soort) {
    case 'antwoord': {
      await db.from('leads').update({ status: 'kwalificeren' }).eq('id', lead.id);
      await naarKlant(b.vanNummer, besluit.tekst, lead.id, monteurId, besluit.prijs ? 'prijsindicatie' : 'vervolgvraag');
      await seintjes(b, besluit.signalen, besluit.tekst, besluit.extraWerk);
      break;
    }

    case 'afwijzing': {
      await db.from('leads').update({
        status: 'afgewezen',
        afwijsreden: besluit.reden,
      }).eq('id', lead.id);
      await naarKlant(b.vanNummer, besluit.tekst, lead.id, monteurId, 'afwijzing');
      await naarMonteur(
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
      await seintjes(b, besluit.signalen, besluit.tekst, besluit.extraWerk);
      await naarMonteur(meldingIngepland({ ...lead, ...naarLead(besluit.kwalificatie) }, besluit, kosten, dagen));
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
  await naarMonteur(
    `Overdracht (${reden})\nvan ${nummer}\n${samenvatting}` +
      (concept ? `\n\nVoorstel antwoord:\n${concept}` : '') +
      `\n\nDe bot antwoordt deze klant niet meer; reageer zelf vanaf het botnummer.`,
  );
  const tekst =
    klanttekst ?? `Ik leg dit even voor aan ${profiel.aanspreeknaam || 'de monteur'}, hij reageert vandaag zelf.`;
  if (!MEELEZEN) await transport.stuur(nummer, tekst);
  await db.from('berichten').insert({ lead_id: leadId, richting: 'uit', afzender: 'bot', tekst });
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
  await seintjes(b, sig, tekst);
}

const SEINTJE_UITLEG: Record<Signaal, string> = {
  prijsbezwaar: 'Prijsbezwaar. De bot heeft onderbouwd en gezegd dat de klant het bedrag met jou kan bespreken.',
  prijsvraag: 'Klant vraagt naar de prijs.',
  klacht: 'Klacht of boze klant. De bot heeft gezegd dat jij het bericht krijgt.',
  wil_monteur: 'Klant vraagt naar jou. De bot heeft gezegd dat je contact opneemt zodra de datum staat.',
  twijfel: 'De bot twijfelde over zijn antwoord. Kijk even mee.',
  extra_werk: 'Werk zonder vaste prijs; de bot heeft gezegd dat jij het apart in de offerte zet.',
  budget: 'Klant kan het bedrag niet betalen. Het gesprek is aan jou overgedragen.',
};

/** Seintje aan de monteur. Het gesprek blijft bij de bot. */
async function seintjes(b: InkomendBericht, signalen: Signaal[], antwoord: string, extraWerk?: string[]) {
  if (!signalen.length) return;
  const regels = [...new Set(signalen)].map((s) =>
    s === 'extra_werk' && extraWerk?.length ? `${SEINTJE_UITLEG[s]} (${extraWerk.join(', ')})` : SEINTJE_UITLEG[s] ?? s,
  );
  await naarMonteur(
    `Seintje — ${b.vanNummer}\n${regels.join('\n')}\n\nKlant: "${b.tekst.slice(0, 400)}"\n\nBot: "${antwoord.slice(0, 400)}"\n\nDe bot praat verder; je hoeft niets te doen.`,
  );
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
      const bezet = await agendaBezetting(google, start, dagen, []);
      if (bezet.some((x) => x.start < eind && x.eind > start)) {
        await draagOver(
          lead.id, monteurId, b.vanNummer, profiel, 'buiten_regels',
          `Klant koos ${omschrijving}, maar dat staat intussen bezet in de agenda.`,
          undefined,
          `Ik check het moment nog even met ${naam}, hij bevestigt het vandaag zelf.`,
        );
        return;
      }

      eventId = await vastleggen(google, {
        soort: gekozen.soort,
        start,
        eind,
        klantNaam: lead.klant_naam ?? undefined,
        klantTelefoon: b.vanNummer,
        adres: lead.plaats ?? (lead.pc4 ? String(lead.pc4) : undefined),
        notitie: agendaNotitie(lead),
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
    `Ingepland en aan jou overgedragen: ${gekozen.soort} ${omschrijving}\nklant ${b.vanNummer}${lead.klant_naam ? ` (${lead.klant_naam})` : ''}` +
      `\n${agendaNotitie(lead)}` +
      (eventId ? '\nStaat in je Google Agenda.' : MEELEZEN ? '\n(meeleesmodus: niet in Google gezet)' : ''),
  );
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
  _monteurId: string,
  soort: string,
) {
  if (MEELEZEN) {
    await naarMonteur(`[meelezen · ${soort}] naar ${nummer}:\n\n${tekst}`);
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

async function naarMonteur(tekst: string) {
  try {
    await transport.stuur(MONTEUR_WHATSAPP, tekst);
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
    return await agendaBezetting(google, vanaf, dagen, eigen);
  } catch (e) {
    // Zonder agenda liever niets voorstellen dan iets fouts: geef de eigen
    // afspraken terug én log luid, zodat je het merkt.
    console.error('AGENDA ONBEREIKBAAR:', String(e));
    await naarMonteur(`Let op: de agenda is onbereikbaar. ${String(e)}`);
    return eigen;
  }
}

async function ruimOp() {
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
