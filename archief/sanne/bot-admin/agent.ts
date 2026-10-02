// Klant-assistent: systeemprompt, tools en tool-executor.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AnthropicTool, Msg } from "./llm.ts";
import { runAgent } from "./llm.ts";
import { sendText, mailOwner, normPhone } from "./whatsapp.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://rotterdam-keukenmontage.nl";
const CALENDLY = "https://calendly.com/josskeukenmontage/belafspraak-kennismaking";

export type Instellingen = Record<string, unknown>;

export async function laadInstellingen(sb: SupabaseClient): Promise<Instellingen> {
  const { data } = await sb.from("bot_instellingen").select("key, waarde");
  const out: Instellingen = {};
  for (const r of data ?? []) out[r.key as string] = r.waarde;
  return out;
}

export async function laadPrijzen(sb: SupabaseClient) {
  const { data } = await sb
    .from("prijzen_diensten")
    .select("slug, naam, categorie, aliassen, status, prijsmodel, prijs_min, prijs_max, eenheid, uurtarief, minimumbedrag, toelichting, vragen, calculator_dienst_type")
    .in("status", ["actief"])
    .order("id");
  return data ?? [];
}

function prijzenBlok(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "(nog geen diensten in de prijzenlijst)";
  return rows.map((r) => {
    const regels: string[] = [];
    regels.push(`### ${r.naam}  [slug: ${r.slug}]`);
    if ((r.aliassen as string[])?.length) regels.push(`Klanten noemen dit ook: ${(r.aliassen as string[]).join(", ")}`);
    if (r.prijsmodel === "calculator") {
      regels.push(`Prijs: bereken via de tool bereken_prijs met dienst_type = "${r.calculator_dienst_type}".`);
    } else {
      const min = r.prijs_min != null ? `EUR ${r.prijs_min}` : "";
      const max = r.prijs_max != null ? ` - EUR ${r.prijs_max}` : "";
      regels.push(`Prijs (excl. BTW): ${min}${max} ${r.eenheid ? `(${r.eenheid})` : ""}`);
      if (r.uurtarief) regels.push(`Uurtarief: EUR ${r.uurtarief} excl. BTW`);
    }
    if (r.minimumbedrag) regels.push(`Minimumbedrag: EUR ${r.minimumbedrag} excl. BTW`);
    if (r.toelichting) regels.push(`Toelichting: ${r.toelichting}`);
    const v = r.vragen as string[] | null;
    if (v?.length) regels.push(`Uit te vragen: ${v.join(" | ")}`);
    return regels.join("\n");
  }).join("\n\n");
}

export async function bouwSysteemPrompt(sb: SupabaseClient, inst: Instellingen, gesprek: Record<string, unknown> | null): Promise<string> {
  const prijzen = await laadPrijzen(sb);
  const { data: acties } = await sb.from("bot_offers").select("title, description, conditions, valid_until").eq("active", true);
  const naam = (inst["assistent_naam"] as string) ?? "Sanne";
  const werkgebied = (inst["werkgebied"] as string) ?? "Rotterdam en omstreken";
  const vandaag = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });

  const bekend = gesprek
    ? `Wat we al van deze klant weten:\n${JSON.stringify({
        naam: gesprek.naam, email: gesprek.email, adres: gesprek.adres, postcode: gesprek.postcode,
        dienst: gesprek.dienst_focus, gegevens: gesprek.verzamelde_data, aanvraag_id: gesprek.aanvraag_id,
      }, null, 1)}`
    : "Dit is een nieuwe klant, we weten nog niets.";

  const actieBlok = (acties ?? []).length
    ? `\n## Lopende acties (alleen noemen als het echt past)\n${(acties ?? []).map((a) => `- ${a.title}: ${a.description}${a.conditions ? ` (voorwaarden: ${a.conditions})` : ""}`).join("\n")}`
    : "";

  return `Je bent ${naam}, de persoonlijke assistent van Jos van Rotterdam Keukenmontage. Je beantwoordt WhatsApp-berichten van klanten.

Vandaag is het ${vandaag}. Werkgebied: ${werkgebied}.

# Wie je bent
Je werkt vóór Jos, je bent niet Jos zelf. Je doet je nooit voor als mens.
In je ALLEREERSTE bericht aan een nieuwe klant maak je in één korte zin duidelijk dat de klant met de digitale assistent van Rotterdam Keukenmontage chat en dat Jos zelf meekijkt en het overneemt zodra dat nodig is. Daarna niet meer herhalen, tenzij iemand ernaar vraagt.
Vraagt iemand of je een computer/AI bent: bevestig dat eerlijk en direct.
Wil iemand een mens spreken: gebruik meteen escaleer_naar_jos en geef ook het telefoonnummer of de belafspraak-link. Je houdt niemand op.

# Je doel
Van een vage vraag ("wat kost een keuken monteren?") een concrete, inplanbare opdracht maken:
1. Uitvinden wat de klant precies wil.
2. De juiste gegevens ophalen om een prijs te kunnen geven.
3. Een prijsindicatie of officiele offerte geven.
4. Een afspraak of belafspraak inplannen.

# Toon
- Nederlands, u-vorm, warm en vakkundig. Kort. Dit is WhatsApp, geen brief.
- Meestal 2 tot 5 zinnen. Nooit lange lappen tekst, geen kopjes, geen opsommingen van meer dan 4 punten.
- Stel maximaal 2 vragen per bericht. Liever 1.
- Geen emoji's, behalve heel af en toe een enkele als de klant dat ook doet.
- Geen jargon. Ontzorgen en precisie zijn de kernwoorden.
- Nooit "als AI-assistent" of vergelijkbare formuleringen.

# Waar je NIET over gaat
Je praat uitsluitend over Rotterdam Keukenmontage: keukens, kasten, montage, demontage, wrappen, maatwerk, prijzen, offertes, planning en afspraken. Vraagt iemand iets wat daar los van staat (huiswerk, nieuws, recepten, algemene vragen), dan help je daar vriendelijk niet mee en breng je het gesprek terug naar de keuken. Dit is geen algemene chatbot.

# Prijsregels (belangrijk)
- Je verzint NOOIT een prijs. Je noemt alleen bedragen die uit de tool bereken_prijs komen of letterlijk in de prijzenlijst hieronder staan.
- Prijzen in de lijst en uit de calculator zijn EXCL. 21% BTW. Naar particuliere klanten communiceer je INCL. BTW en zeg je dat er ook zo bij ("inclusief btw").
- Noem een bedrag altijd als indicatie/richtprijs zolang je niet alle gegevens hebt. Zeg erbij waar het van afhangt.
- Staat een dienst NIET in de lijst hieronder? Dan geef je GEEN prijs. Je gebruikt dan de tool vraag_jos_om_prijs, en je zegt tegen de klant dat je het even kort met Jos afstemt en binnen enkele uren terugkomt met een prijs.
- Kortingen geef je nooit zelf weg, tenzij ze bij "Lopende acties" staan.

# Werkwijze
- Nieuwe klant: begroet kort, vraag naar de naam en wat er precies moet gebeuren.
- Gebruik onthoud_klant zodra je iets nieuws weet (naam, e-mail, adres, postcode, afmetingen, aantallen). Doe dit vaak, dan raakt niets kwijt.
- Heb je genoeg gegevens en een e-mailadres? Gebruik stuur_offerte. De klant krijgt dan direct een PDF-offerte per mail en een link om een datum te kiezen.
- Wil de klant liever bellen of twijfelt hij? Gebruik plan_afspraak.
- Klacht, garantiekwestie, boze klant, onderhandeling over de prijs, iets wat je niet zeker weet: gebruik escaleer_naar_jos en zeg tegen de klant dat Jos er persoonlijk naar kijkt.

# Prijzenlijst
${prijzenBlok(prijzen)}${actieBlok}

# ${bekend}`;
}

export const KLANT_TOOLS: AnthropicTool[] = [
  {
    name: "bereken_prijs",
    description: "Berekent een prijs met de officiele calculator van Rotterdam Keukenmontage. Gebruik dit voor elke dienst waarbij in de prijzenlijst 'bereken via de tool bereken_prijs' staat. Geeft de offerteregels, subtotaal excl. BTW, totaal incl. BTW en de geschatte werktijd terug. Vul zo veel mogelijk velden in; ontbrekende velden worden als 0/leeg behandeld, dus vraag de klant eerst naar de belangrijkste gegevens.",
    input_schema: {
      type: "object",
      properties: {
        dienst_type: { type: "string", description: "Exacte calculator-naam, bijv. 'Keukenplaatsing', 'Demontage oude keuken', 'Inmeten & Advies', 'Wrappen & Fronten', 'Kasten Monteren', 'Keukenblad vervangen', 'Fronten vervangen', 'Spoelbak en/of kraan vervangen', 'Inbouwapparaat vervangen', 'Achterwand plaatsen', 'Tweedekans-keuken plaatsen'." },
        gegevens: { type: "object", description: "De formuliervelden voor deze dienst, zoals genoemd bij 'Uit te vragen' in de prijzenlijst. Bijv. {lengte: 4, hangkasten: 3, levering_type: 'Bouwpakket', elementen: ['Vaatwasser'], postcode: '3011AB'}." },
      },
      required: ["dienst_type", "gegevens"],
    },
  },
  {
    name: "onthoud_klant",
    description: "Slaat op wat je van de klant weet, zodat het in een volgend bericht nog bekend is. Gebruik dit zodra je iets nieuws hoort.",
    input_schema: {
      type: "object",
      properties: {
        naam: { type: "string" },
        email: { type: "string" },
        adres: { type: "string", description: "Straat en huisnummer" },
        postcode: { type: "string" },
        dienst_focus: { type: "string", description: "Welke dienst het gesprek over gaat" },
        gegevens: { type: "object", description: "Losse feiten en formuliervelden, worden samengevoegd met wat er al staat" },
        samenvatting: { type: "string", description: "Een of twee zinnen: wat wil deze klant" },
      },
      required: [],
    },
  },
  {
    name: "stuur_offerte",
    description: "Maakt een officiele offerte aan: de klant krijgt direct een PDF per e-mail met een link om een datum te kiezen, en Jos krijgt een kopie. Gebruik dit pas als je naam, e-mailadres, dienst en de belangrijkste gegevens hebt. Werkt alleen voor diensten die de calculator kent.",
    input_schema: {
      type: "object",
      properties: {
        naam: { type: "string" },
        email: { type: "string" },
        postcode: { type: "string" },
        dienst_type: { type: "string", description: "Exacte calculator-naam" },
        gegevens: { type: "object", description: "Dezelfde velden als bij bereken_prijs" },
      },
      required: ["naam", "email", "dienst_type", "gegevens"],
    },
  },
  {
    name: "plan_afspraak",
    description: "Geeft de klant de juiste link om zelf een moment te kiezen: een planlink op maat als er al een offerte is, anders een link voor een vrijblijvende belafspraak van 15 minuten.",
    input_schema: {
      type: "object",
      properties: {
        soort: { type: "string", enum: ["belafspraak", "montagedatum"], description: "belafspraak = kennismaking bellen; montagedatum = datum kiezen voor de klus (vereist een eerder verstuurde offerte)" },
      },
      required: ["soort"],
    },
  },
  {
    name: "vraag_jos_om_prijs",
    description: "Gebruik dit als de klant iets vraagt dat NIET in de prijzenlijst staat. Je stuurt Jos een voorstel: voeren wij dit uit, en zo ja voor welke prijs. Doe eerst je best om een marktconforme richtprijs voor te stellen op basis van vergelijkbaar werk in de lijst en je algemene kennis van de Nederlandse markt. Zeg daarna tegen de klant dat je het even met Jos afstemt.",
    input_schema: {
      type: "object",
      properties: {
        dienst_naam: { type: "string", description: "Korte naam van de nieuwe dienst, bijv. 'Meterkast verplaatsen'" },
        klant_vraag: { type: "string", description: "Wat de klant letterlijk vroeg" },
        omschrijving: { type: "string", description: "Wat het werk inhoudt, in 1-2 zinnen" },
        voorstel_prijs_min: { type: "number", description: "Voorgestelde ondergrens EXCL. BTW" },
        voorstel_prijs_max: { type: "number", description: "Voorgestelde bovengrens EXCL. BTW" },
        eenheid: { type: "string", description: "bijv. 'per klus', 'per uur', 'per strekkende meter'" },
        geschatte_tijd_minuten: { type: "number" },
        onderbouwing: { type: "string", description: "Waarom deze prijs marktconform is" },
      },
      required: ["dienst_naam", "klant_vraag", "omschrijving", "voorstel_prijs_min", "voorstel_prijs_max", "eenheid", "onderbouwing"],
    },
  },
  {
    name: "escaleer_naar_jos",
    description: "Stuurt Jos direct een bericht en zet dit gesprek op 'wacht op Jos'. Gebruik bij klachten, garantie, onderhandeling, boosheid, of als je het antwoord echt niet weet.",
    input_schema: {
      type: "object",
      properties: {
        reden: { type: "string" },
        samenvatting: { type: "string", description: "Wat Jos moet weten om meteen te kunnen reageren" },
        concept_antwoord: { type: "string", description: "Optioneel: wat jij zou antwoorden, zodat Jos het alleen hoeft goed te keuren" },
      },
      required: ["reden", "samenvatting"],
    },
  },
];

function fmt(n: number): string {
  return n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function maakExecutor(sb: SupabaseClient, telefoon: string, inst: Instellingen) {
  const eigenaar = normPhone(String(inst["eigenaar_telefoon"] ?? ""));

  async function meldJos(tekst: string, mailSubject: string) {
    const r = await sendText(eigenaar, tekst);
    if (!r.ok) {
      await mailOwner(mailSubject, `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap;font-size:14px">${tekst.replace(/</g, "&lt;")}</pre>
        <p style="color:#888;font-size:12px">WhatsApp naar Jos lukte niet (${r.error ?? "onbekend"}). ${r.needsTemplate ? "Waarschijnlijk buiten het 24-uursvenster: stuur even een WhatsApp naar het zakelijke nummer om het venster te openen." : ""}</p>`);
    }
  }

  return async function execute(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "bereken_prijs": {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ dry_run: true, dienst_type: input.dienst_type, formulier_data: input.gegevens ?? {} }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.bekend_bij_calculator === false) {
          return { gelukt: false, reden: `De calculator kent '${input.dienst_type}' niet of kreeg te weinig gegevens. Gebruik vraag_jos_om_prijs, of vraag de klant om de ontbrekende gegevens.`, ruwe_respons: json };
        }
        return {
          gelukt: true,
          regels: json.items,
          subtotaal_excl_btw: json.subtotaal_excl_btw,
          totaal_incl_btw: json.totaal_incl_btw,
          totaal_incl_btw_tekst: `EUR ${fmt(json.totaal_incl_btw)}`,
          geschatte_tijd_minuten: json.totaal_minuten,
          geschatte_werkdagen: json.geschatte_werkdagen,
          let_op: "Noem naar de klant het bedrag INCLUSIEF btw en zeg erbij dat het een richtprijs is zolang niet alles bekend is.",
        };
      }

      case "onthoud_klant": {
        const { data: huidig } = await sb.from("wa_gesprekken").select("verzamelde_data").eq("customer_phone", telefoon).maybeSingle();
        const samen = { ...(huidig?.verzamelde_data ?? {}), ...((input.gegevens as Record<string, unknown>) ?? {}) };
        const patch: Record<string, unknown> = { customer_phone: telefoon, verzamelde_data: samen };
        for (const k of ["naam", "email", "adres", "postcode", "dienst_focus", "samenvatting"]) {
          if (input[k]) patch[k] = input[k];
        }
        await sb.from("wa_gesprekken").upsert(patch, { onConflict: "customer_phone" });
        return { gelukt: true, opgeslagen: patch };
      }

      case "stuur_offerte": {
        const { data: g } = await sb.from("wa_gesprekken").select("*").eq("customer_phone", telefoon).maybeSingle();
        const postcode = (input.postcode as string) ?? g?.postcode ?? null;
        const { data: aanvraag, error: aErr } = await sb.from("aanvragen").insert({
          naam: input.naam, email: input.email, telefoon: "+" + telefoon,
          postcode, dienst: input.dienst_type, bron: "whatsapp",
          bericht: g?.samenvatting ?? null,
        }).select("id").single();
        if (aErr) return { gelukt: false, reden: `Aanmaken aanvraag mislukt: ${aErr.message}` };

        const gegevens = { ...((g?.verzamelde_data as Record<string, unknown>) ?? {}), ...((input.gegevens as Record<string, unknown>) ?? {}) };
        if (postcode && !gegevens.postcode) gegevens.postcode = postcode;
        if (g?.adres && !gegevens.adres) gegevens.adres = g.adres;

        const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ aanvraag_id: aanvraag.id, dienst_type: input.dienst_type, formulier_data: gegevens }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { gelukt: false, reden: `Offerte versturen mislukt: ${JSON.stringify(json)}` };

        await sb.from("wa_gesprekken").upsert({
          customer_phone: telefoon, aanvraag_id: aanvraag.id, naam: input.naam, email: input.email,
          postcode, dienst_focus: input.dienst_type, verzamelde_data: gegevens,
        }, { onConflict: "customer_phone" });
        await sb.from("whatsapp_leads").upsert({
          customer_phone: telefoon, name: input.naam as string, service_type: input.dienst_type as string, stage: "quoted",
        }, { onConflict: "customer_phone" });

        return {
          gelukt: true,
          aanvraag_id: aanvraag.id,
          planlink: `${SITE_URL}/plannen.html?id=${aanvraag.id}`,
          bericht: "De offerte is per e-mail verstuurd met PDF-bijlage. Vertel de klant dat de mail onderweg is (ook even spam checken) en geef de planlink zodat hij zelf een datum kan kiezen.",
        };
      }

      case "plan_afspraak": {
        const { data: g } = await sb.from("wa_gesprekken").select("aanvraag_id").eq("customer_phone", telefoon).maybeSingle();
        if (input.soort === "montagedatum" && g?.aanvraag_id) {
          return { gelukt: true, link: `${SITE_URL}/plannen.html?id=${g.aanvraag_id}`, uitleg: "Hier kiest de klant zelf een beschikbare dag; de agenda van Jos is gekoppeld." };
        }
        if (input.soort === "montagedatum") {
          return { gelukt: false, reden: "Er is nog geen offerte voor deze klant. Stuur eerst een offerte met stuur_offerte, of bied een belafspraak aan." };
        }
        return { gelukt: true, link: CALENDLY, uitleg: "Vrijblijvende belafspraak van 15 minuten met Jos." };
      }

      case "vraag_jos_om_prijs": {
        const { data: v, error } = await sb.from("prijs_voorstellen").insert({
          customer_phone: telefoon,
          klant_vraag: input.klant_vraag,
          dienst_naam: input.dienst_naam,
          voorstel_prijsmodel: "bandbreedte",
          voorstel_prijs_min: input.voorstel_prijs_min,
          voorstel_prijs_max: input.voorstel_prijs_max,
          voorstel_eenheid: input.eenheid,
          voorstel_tijd_minuten: input.geschatte_tijd_minuten ?? null,
          onderbouwing: `${input.omschrijving}\n\n${input.onderbouwing}`,
        }).select("id").single();
        if (error) return { gelukt: false, reden: error.message };

        await sb.from("wa_gesprekken").upsert({ customer_phone: telefoon, status: "wacht_op_jos" }, { onConflict: "customer_phone" });

        const min = Number(input.voorstel_prijs_min), max = Number(input.voorstel_prijs_max);
        await meldJos(
          `*Nieuwe klus die we (nog) niet in de prijslijst hebben*\n\n` +
          `Klant (+${telefoon}) vraagt:\n"${input.klant_vraag}"\n\n` +
          `*${input.dienst_naam}*\n${input.omschrijving}\n\n` +
          `Mijn voorstel: *EUR ${fmt(min)} - ${fmt(max)}* excl. btw ${input.eenheid}\n` +
          `(= EUR ${fmt(min * 1.21)} - ${fmt(max * 1.21)} incl. btw)\n` +
          (input.geschatte_tijd_minuten ? `Geschatte tijd: ${input.geschatte_tijd_minuten} min\n` : "") +
          `\n${input.onderbouwing}\n\n` +
          `Doen we dit? Antwoord bijvoorbeeld:\n` +
          `"${v.id} ja" — akkoord, ik zet het in de prijslijst\n` +
          `"${v.id} ja 400-650" — akkoord met jouw bedragen\n` +
          `"${v.id} nee" — dit doen we niet\n\n` +
          `Voorstel #${v.id}`,
          `Prijsvoorstel #${v.id}: ${input.dienst_naam}`,
        );

        return {
          gelukt: true,
          voorstel_id: v.id,
          bericht: "Jos heeft het voorstel gekregen. Zeg tegen de klant dat je dit even kort met Jos afstemt en dat je vandaag nog terugkomt met een prijs. Noem NU nog geen bedrag.",
        };
      }

      case "escaleer_naar_jos": {
        await sb.from("needs_review").insert({
          customer_phone: telefoon,
          customer_message: String(input.samenvatting ?? ""),
          draft_reply: String(input.concept_antwoord ?? ""),
          reason: String(input.reden ?? ""),
        });
        await sb.from("wa_gesprekken").upsert({ customer_phone: telefoon, status: "wacht_op_jos" }, { onConflict: "customer_phone" });
        await meldJos(
          `*Even meekijken graag*\n\nKlant: +${telefoon}\nReden: ${input.reden}\n\n${input.samenvatting}` +
          (input.concept_antwoord ? `\n\nMijn concept-antwoord:\n"${input.concept_antwoord}"\n\nStuur "ok" om dit te versturen, of typ zelf een antwoord met "aan +${telefoon} <tekst>".` : ""),
          `WhatsApp-assistent heeft hulp nodig (+${telefoon})`,
        );
        return { gelukt: true, bericht: "Jos is ingeseind. Laat de klant weten dat Jos er persoonlijk naar kijkt en snel reageert." };
      }
    }
    return { fout: `Onbekende tool ${name}` };
  };
}

// ---------------------------------------------------------------------------
// Volledige beurt: geschiedenis laden, agent draaien, antwoord versturen+loggen
// ---------------------------------------------------------------------------

export async function logBericht(sb: SupabaseClient, telefoon: string, richting: "inbound" | "outbound", body: string, waId?: string | null, meta: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = { customer_phone: telefoon, direction: richting, body, meta };
  if (waId) row.wa_message_id = waId;
  const { error } = await sb.from("message_log").insert(row);
  if (error && !String(error.message).includes("duplicate")) console.error("log fout:", error.message);
  return !error;
}

async function laadGeschiedenis(sb: SupabaseClient, telefoon: string, limiet = 24): Promise<Msg[]> {
  const { data } = await sb.from("message_log")
    .select("direction, body, created_at")
    .eq("customer_phone", telefoon)
    .order("created_at", { ascending: false })
    .limit(limiet);
  const rijen = (data ?? []).reverse();
  const msgs: Msg[] = [];
  for (const r of rijen) {
    const rol = r.direction === "inbound" ? "user" : "assistant";
    const laatste = msgs[msgs.length - 1];
    if (laatste && laatste.role === rol) {
      laatste.content = `${laatste.content}\n${r.body}`;
    } else {
      msgs.push({ role: rol as "user" | "assistant", content: String(r.body ?? "") });
    }
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

/**
 * Laat de assistent antwoorden op de huidige stand van het gesprek.
 * `notitie` is een interne instructie (bijv. "Jos heeft de prijs goedgekeurd")
 * die als laatste gebruikersbeurt wordt meegegeven maar niet naar de klant gaat.
 */
export async function antwoordKlant(sb: SupabaseClient, telefoon: string, notitie?: string): Promise<string> {
  const inst = await laadInstellingen(sb);
  const { data: gesprek } = await sb.from("wa_gesprekken").select("*").eq("customer_phone", telefoon).maybeSingle();
  const system = await bouwSysteemPrompt(sb, inst, gesprek ?? null);
  const messages = await laadGeschiedenis(sb, telefoon);

  if (notitie) {
    const laatste = messages[messages.length - 1];
    const tekst = `[interne notitie, niet van de klant] ${notitie}`;
    if (laatste && laatste.role === "user") laatste.content = `${laatste.content}\n\n${tekst}`;
    else messages.push({ role: "user", content: tekst });
  }
  if (!messages.length) messages.push({ role: "user", content: "[interne notitie] Nieuw gesprek, begroet de klant kort." });

  const result = await runAgent({
    system,
    messages,
    tools: KLANT_TOOLS,
    execute: maakExecutor(sb, telefoon, inst),
  });

  const tekst = (result.text ?? "").trim();
  if (!tekst) {
    const val = "Even geduld — ik zoek dit voor u uit en kom er zo bij u op terug.";
    await sendText(telefoon, val);
    await logBericht(sb, telefoon, "outbound", val, null, { fallback: true });
    return val;
  }
  await sendText(telefoon, tekst);
  await logBericht(sb, telefoon, "outbound", tekst, null, { tools: result.toolCalls.map((t) => t.name) });
  return tekst;
}
