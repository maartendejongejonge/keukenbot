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
import { verwerkBericht, type LeadContext } from './orchestrator.js';
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

  await transport.start(behandel);

  // Verlopen reserveringen opruimen: elk kwartier.
  setInterval(ruimOp, 15 * 60 * 1000);
  await ruimOp();
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

  const { data: profiel } = await db
    .from('monteur_profielen')
    .select('*')
    .eq('monteur_id', monteurId)
    .single();

  if (!profiel) return;

  const lead = await vindOfMaakLead(monteurId, kanaal.data.id, b.vanNummer);

  await db.from('berichten').insert({
    lead_id: lead.id,
    richting: 'in',
    afzender: 'klant',
    tekst: b.tekst,
  });

  const ctx: LeadContext = {
    kwalificatie: pakKwalificatie(lead),
    vervolgvragen: await telBotberichten(lead.id),
    historie: await historie(lead.id),
  };

  const besluit = await verwerkBericht(b.tekst, ctx, profiel, {
    duidBericht: duidBericht,
    bezetting: (vanaf, dagen) => bezettingVoor(monteurId, vanaf, dagen),
  });

  switch (besluit.soort) {
    case 'antwoord': {
      await db.from('leads').update({
        ...besluit.kwalificatie,
        status: 'kwalificeren',
        laatste_bericht_op: new Date().toISOString(),
      }).eq('id', lead.id);
      await naarKlant(b.vanNummer, besluit.tekst, lead.id, monteurId, 'vervolgvraag');
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
      const kosten = berekenReis(besluit.slots[0] ? lead : lead, profiel);

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
      await naarMonteur(meldingIngepland(lead, besluit, kosten, dagen));
      break;
    }

    case 'overdracht': {
      await db.from('leads').update({ status: 'overgedragen' }).eq('id', lead.id);
      await db.from('review_items').insert({
        monteur_id: monteurId,
        lead_id: lead.id,
        reden: besluit.reden,
        samenvatting: besluit.samenvatting,
        voorgesteld_antwoord: besluit.concept ?? null,
      });
      await naarMonteur(
        `Overdracht (${besluit.reden})\nvan ${b.vanNummer}\n${besluit.samenvatting}` +
          (besluit.concept ? `\n\nVoorstel antwoord:\n${besluit.concept}` : ''),
      );
      if (!MEELEZEN) {
        await transport.stuur(
          b.vanNummer,
          'Ik leg dit even voor aan de monteur, hij reageert vandaag zelf.',
        );
      }
      break;
    }
  }
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
  besluit: Extract<Awaited<ReturnType<typeof verwerkBericht>>, { soort: 'voorstel' }>,
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
    .in('status', ['nieuw', 'kwalificeren', 'gekwalificeerd'])
    .order('aangemaakt_op', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) return data;

  const { data: nieuw } = await db
    .from('leads')
    .insert({ monteur_id: monteurId, kanaal_id: kanaalId, klant_telefoon: nummer })
    .select()
    .single();

  return nieuw!;
}

function pakKwalificatie(lead: any) {
  const { pc4, plaats, type_klus, leverancier, omvang, installatiewerk,
          keuken_geleverd, gewenste_periode } = lead;
  return { pc4, plaats, type_klus, leverancier, omvang, installatiewerk,
           keuken_geleverd, gewenste_periode };
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

async function duidBericht(
  systeem: string,
  hist: { afzender: string; tekst: string }[],
  bericht: string,
  gevraagd: string | null,
) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: `${systeem}

Antwoord uitsluitend met JSON, zonder toelichting of code-fences:
{"velden":{},"antwoord":"","confidence":0.0,"overdracht":null}
"velden" bevat alleen wat de klant nu echt heeft gezegd. Voor postcode geef je
de vier cijfers als getal in "pc4".
${gevraagd ? `Je vraagt nu naar: ${gevraagd}.` : 'Alles is bekend; bevestig kort.'}`,
      messages: [
        ...hist.map((h) => ({
          role: h.afzender === 'klant' ? 'user' : 'assistant',
          content: h.tekst,
        })),
        { role: 'user', content: bericht },
      ],
    }),
  });

  const data = await res.json();
  const tekst = (data.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  try {
    return JSON.parse(tekst);
  } catch {
    // Onparseerbaar antwoord is per definitie onbetrouwbaar.
    return { velden: {}, antwoord: '', confidence: 0 };
  }
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
