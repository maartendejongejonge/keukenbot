/**
 * Vercel-webhook voor de WhatsApp Business Cloud API.
 *
 * Eén endpoint voor alle monteurs: het phone_number_id in de payload bepaalt
 * bij welke monteur het bericht hoort. Nooit een monteur_id uit de request
 * zelf vertrouwen.
 */

import { createClient } from '@supabase/supabase-js';
import { verwerkBericht, type LeadContext } from '../src/orchestrator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'nodejs' };

export default async function handler(req: Request): Promise<Response> {
  // Meta's verificatiehandshake bij het instellen van de webhook.
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const ruw = await req.text();
  if (!geldigeHandtekening(ruw, req.headers.get('x-hub-signature-256'))) {
    return new Response('bad signature', { status: 401 });
  }

  // Meta verwacht binnen enkele seconden een 200, anders volgen retries.
  // Verwerken doen we daarom los van het antwoord.
  const payload = JSON.parse(ruw);
  void verwerk(payload).catch((e) => console.error('verwerken mislukt', e));

  return new Response('ok', { status: 200 });
}

async function verwerk(payload: any) {
  const change = payload?.entry?.[0]?.changes?.[0]?.value;
  const bericht = change?.messages?.[0];
  if (!bericht || bericht.type !== 'text') return;

  const phoneNumberId: string = change.metadata.phone_number_id;
  const vanNummer: string = bericht.from;
  const tekst: string = bericht.text.body;

  const { data: kanaal } = await supabase
    .from('kanalen')
    .select('id, monteur_id')
    .eq('soort', 'whatsapp')
    .eq('externe_id', phoneNumberId)
    .eq('actief', true)
    .single();

  if (!kanaal) return; // onbekend nummer: stilzwijgend negeren

  const { data: profiel } = await supabase
    .from('monteur_profielen')
    .select('*')
    .eq('monteur_id', kanaal.monteur_id)
    .single();

  if (!profiel) return;

  const lead = await vindOfMaakLead(kanaal.monteur_id, kanaal.id, vanNummer);

  await supabase.from('berichten').insert({
    lead_id: lead.id,
    richting: 'in',
    afzender: 'klant',
    tekst,
  });

  const ctx: LeadContext = {
    kwalificatie: pakKwalificatie(lead),
    vervolgvragen: await telVervolgvragen(lead.id),
    historie: await historie(lead.id),
  };

  const besluit = await verwerkBericht(tekst, ctx, profiel, deps(kanaal.monteur_id));

  switch (besluit.soort) {
    case 'antwoord':
      await supabase.from('leads').update({
        ...besluit.kwalificatie,
        status: 'kwalificeren',
        laatste_bericht_op: new Date().toISOString(),
      }).eq('id', lead.id);
      await stuur(phoneNumberId, vanNummer, besluit.tekst, lead.id);
      break;

    case 'afwijzing':
      await supabase.from('leads').update({
        status: 'afgewezen',
        afwijsreden: besluit.reden,
      }).eq('id', lead.id);
      await stuur(phoneNumberId, vanNummer, besluit.tekst, lead.id);
      await meldAanMonteur(kanaal.monteur_id, lead.id, 'buiten_regels',
        `Automatisch afgewezen: ${besluit.reden}`);
      break;

    case 'voorstel':
      await supabase.from('afspraken').insert(
        besluit.slots.map((s) => ({
          monteur_id: kanaal.monteur_id,
          lead_id: lead.id,
          soort: s.soort,
          start_op: s.start.toISOString(),
          eind_op: s.eind.toISOString(),
          status: 'voorlopig',
          vervalt_op: besluit.vervalt_op.toISOString(),
        })),
      );
      await supabase.from('leads').update({ status: 'gekwalificeerd' }).eq('id', lead.id);
      await stuur(phoneNumberId, vanNummer, besluit.tekst, lead.id);
      break;

    case 'overdracht':
      await supabase.from('leads').update({ status: 'overgedragen' }).eq('id', lead.id);
      await meldAanMonteur(kanaal.monteur_id, lead.id, besluit.reden,
        besluit.samenvatting, besluit.concept);
      // Naar de klant gaat één neutrale regel, geen stilte.
      await stuur(phoneNumberId, vanNummer,
        'Ik leg dit even voor aan de monteur, hij reageert vandaag zelf.', lead.id);
      break;
  }
}

async function meldAanMonteur(
  monteurId: string,
  leadId: string,
  reden: string,
  samenvatting: string,
  concept?: string,
) {
  await supabase.from('review_items').insert({
    monteur_id: monteurId,
    lead_id: leadId,
    reden,
    samenvatting,
    voorgesteld_antwoord: concept ?? null,
  });
  // TODO: push- of WhatsApp-melding naar de monteur zelf.
}

async function stuur(phoneNumberId: string, naar: string, tekst: string, leadId: string) {
  await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: naar,
      type: 'text',
      text: { body: tekst },
    }),
  });

  await supabase.from('berichten').insert({
    lead_id: leadId,
    richting: 'uit',
    afzender: 'bot',
    tekst,
  });
}

// ------------------------------------------------------------------ hulpjes
// Bewust apart gehouden; hier zit geen besluitvorming in.

function geldigeHandtekening(_ruw: string, _sig: string | null): boolean {
  // TODO: HMAC-SHA256 over de ruwe body met WHATSAPP_APP_SECRET.
  return true;
}

async function vindOfMaakLead(monteurId: string, kanaalId: string, nummer: string) {
  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('monteur_id', monteurId)
    .eq('klant_telefoon', nummer)
    .in('status', ['nieuw', 'kwalificeren', 'gekwalificeerd'])
    .order('aangemaakt_op', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) return data;

  const { data: nieuw } = await supabase
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

async function telVervolgvragen(leadId: string): Promise<number> {
  const { count } = await supabase
    .from('berichten')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('afzender', 'bot');
  return count ?? 0;
}

async function historie(leadId: string) {
  const { data } = await supabase
    .from('berichten')
    .select('afzender, tekst')
    .eq('lead_id', leadId)
    .order('verzonden_op', { ascending: true })
    .limit(20);
  return (data ?? []) as { afzender: 'klant' | 'bot' | 'monteur'; tekst: string }[];
}

function deps(_monteurId: string) {
  return {
    async duidBericht(systeem: string, hist: any[], bericht: string, gevraagd: string | null) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 700,
          system: `${systeem}

Antwoord uitsluitend met JSON, zonder toelichting of code-fences:
{"velden":{},"antwoord":"","confidence":0.0,"overdracht":null}
"velden" bevat alleen wat de klant nu echt heeft gezegd.
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
    },

    async bezetting(_vanaf: Date, _dagen: number) {
      // TODO: Google Calendar freebusy via het opgeslagen refresh token.
      return [];
    },
  };
}
