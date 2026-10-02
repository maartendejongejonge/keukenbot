// Afhandeling van WhatsApp-berichten die van Jos zelf komen.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runAgent, type AnthropicTool } from "./llm.ts";
import { sendText, normPhone } from "./whatsapp.ts";
import { antwoordKlant, logBericht } from "./agent.ts";

function fmt(n: number): string {
  return Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "dienst";
}

/** Zet een goedgekeurd voorstel om in een actieve regel in de prijzenlijst. */
async function keurGoed(sb: SupabaseClient, voorstelId: number, min?: number | null, max?: number | null, opmerking?: string) {
  const { data: v } = await sb.from("prijs_voorstellen").select("*").eq("id", voorstelId).maybeSingle();
  if (!v) return { gelukt: false, reden: `Voorstel #${voorstelId} bestaat niet.` };
  if (v.status !== "open") return { gelukt: false, reden: `Voorstel #${voorstelId} is al afgehandeld (${v.status}).` };

  const pMin = min ?? v.voorstel_prijs_min;
  const pMax = max ?? v.voorstel_prijs_max;
  const slug = slugify(String(v.dienst_naam));

  const { data: dienst, error } = await sb.from("prijzen_diensten").upsert({
    slug,
    naam: v.dienst_naam,
    categorie: "nieuw",
    status: "actief",
    prijsmodel: pMin === pMax ? "vast" : "bandbreedte",
    prijs_min: pMin,
    prijs_max: pMax,
    eenheid: v.voorstel_eenheid,
    geschatte_tijd_minuten: v.voorstel_tijd_minuten,
    toelichting: v.onderbouwing,
    onderbouwing: `Goedgekeurd door Jos via WhatsApp op ${new Date().toISOString()}. ${opmerking ?? ""}`.trim(),
    bron: "ai-voorstel",
    goedgekeurd_op: new Date().toISOString(),
  }, { onConflict: "slug" }).select("id").single();
  if (error) return { gelukt: false, reden: error.message };

  await sb.from("prijs_voorstellen").update({
    status: min != null || max != null ? "aangepast" : "goedgekeurd",
    definitieve_prijs_min: pMin,
    definitieve_prijs_max: pMax,
    prijs_dienst_id: dienst.id,
    jos_antwoord: opmerking ?? null,
    beantwoord_op: new Date().toISOString(),
  }).eq("id", voorstelId);

  // Klant automatisch verder helpen
  let klantBericht = "";
  if (v.customer_phone) {
    await sb.from("wa_gesprekken").upsert({ customer_phone: v.customer_phone, status: "bot" }, { onConflict: "customer_phone" });
    klantBericht = await antwoordKlant(
      sb,
      v.customer_phone,
      `Jos heeft akkoord gegeven op "${v.dienst_naam}": EUR ${fmt(pMin)}${pMax && pMax !== pMin ? ` tot ${fmt(pMax)}` : ""} excl. btw ${v.voorstel_eenheid ?? ""}. ` +
      `Dat is EUR ${fmt(pMin * 1.21)}${pMax && pMax !== pMin ? ` tot ${fmt(pMax * 1.21)}` : ""} inclusief btw. ` +
      `Laat de klant dit nu weten als richtprijs, leg kort uit waar het bedrag van afhangt, en zet de volgende stap: vraag de ontbrekende gegevens of bied een afspraak aan.`,
    );
  }
  return { gelukt: true, dienst_id: dienst.id, prijs_min: pMin, prijs_max: pMax, klant_geinformeerd: !!klantBericht, klant_bericht: klantBericht };
}

async function wijsAf(sb: SupabaseClient, voorstelId: number, reden?: string) {
  const { data: v } = await sb.from("prijs_voorstellen").select("*").eq("id", voorstelId).maybeSingle();
  if (!v) return { gelukt: false, reden: `Voorstel #${voorstelId} bestaat niet.` };
  await sb.from("prijs_voorstellen").update({
    status: "afgewezen", jos_antwoord: reden ?? null, beantwoord_op: new Date().toISOString(),
  }).eq("id", voorstelId);

  let klantBericht = "";
  if (v.customer_phone) {
    await sb.from("wa_gesprekken").upsert({ customer_phone: v.customer_phone, status: "bot" }, { onConflict: "customer_phone" });
    klantBericht = await antwoordKlant(
      sb,
      v.customer_phone,
      `Jos doet "${v.dienst_naam}" niet.${reden ? ` Reden: ${reden}.` : ""} ` +
      `Laat dit vriendelijk en kort weten, verontschuldig je niet overdreven, en kijk of we de klant met iets anders wel kunnen helpen (of verwijs door).`,
    );
  }
  return { gelukt: true, klant_geinformeerd: !!klantBericht, klant_bericht: klantBericht };
}

// --- snelle patroonherkenning: "12 ja", "12 ja 400-650", "12 nee omdat ..." ---
export async function snelleGoedkeuring(sb: SupabaseClient, tekst: string) {
  const m = tekst.trim().match(/^#?(\d{1,6})\s*[,:\-]?\s*(ja|akkoord|ok|oke|oké|prima|doen|nee|niet|nope|afwijzen)\b\s*(.*)$/i);
  if (!m) return null;
  const id = Number(m[1]);
  const woord = m[2].toLowerCase();
  const rest = (m[3] ?? "").trim();
  const negatief = ["nee", "niet", "nope", "afwijzen"].includes(woord);
  if (negatief) return { id, resultaat: await wijsAf(sb, id, rest || undefined), actie: "afgewezen" as const };

  const bereik = rest.match(/(\d+(?:[.,]\d+)?)\s*(?:-|tot|t\/m|–)\s*(\d+(?:[.,]\d+)?)/);
  const enkel = !bereik ? rest.match(/(\d+(?:[.,]\d+)?)/) : null;
  const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const min = bereik ? num(bereik[1]) : enkel ? num(enkel[1]) : null;
  const max = bereik ? num(bereik[2]) : enkel ? num(enkel[1]) : null;
  return { id, resultaat: await keurGoed(sb, id, min, max, rest || undefined), actie: "goedgekeurd" as const };
}

// --- vrije-tekst-afhandeling via een kleine agent -------------------------
const JOS_TOOLS: AnthropicTool[] = [
  { name: "open_voorstellen", description: "Toont alle openstaande prijsvoorstellen en escalaties.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "keur_voorstel_goed", description: "Keurt een prijsvoorstel goed, zet het in de prijzenlijst en informeert de klant automatisch.", input_schema: { type: "object", properties: { voorstel_id: { type: "number" }, prijs_min: { type: "number", description: "Optioneel: aangepaste ondergrens excl. btw" }, prijs_max: { type: "number" }, opmerking: { type: "string" } }, required: ["voorstel_id"] } },
  { name: "wijs_voorstel_af", description: "Wijst een prijsvoorstel af en laat de klant dat weten.", input_schema: { type: "object", properties: { voorstel_id: { type: "number" }, reden: { type: "string" } }, required: ["voorstel_id"] } },
  { name: "zet_dienst_in_prijslijst", description: "Voegt zelf een dienst met prijs toe aan de prijzenlijst, of past een bestaande aan (op slug).", input_schema: { type: "object", properties: { naam: { type: "string" }, slug: { type: "string" }, prijs_min: { type: "number" }, prijs_max: { type: "number" }, eenheid: { type: "string" }, uurtarief: { type: "number" }, toelichting: { type: "string" }, status: { type: "string", enum: ["actief", "gearchiveerd"] } }, required: ["naam"] } },
  { name: "toon_prijslijst", description: "Toont de huidige prijzenlijst.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "stuur_bericht_naar_klant", description: "Stuurt jouw tekst letterlijk door naar een klant.", input_schema: { type: "object", properties: { telefoon: { type: "string" }, tekst: { type: "string" } }, required: ["telefoon", "tekst"] } },
  { name: "neem_gesprek_over", description: "Zet de assistent uit voor een klant, zodat Jos zelf antwoordt.", input_schema: { type: "object", properties: { telefoon: { type: "string" }, uren: { type: "number", description: "Standaard 12" } }, required: ["telefoon"] } },
  { name: "geef_gesprek_terug", description: "Laat de assistent een gesprek weer overnemen.", input_schema: { type: "object", properties: { telefoon: { type: "string" } }, required: ["telefoon"] } },
  { name: "zet_assistent", description: "Zet de hele assistent aan of uit.", input_schema: { type: "object", properties: { aan: { type: "boolean" } }, required: ["aan"] } },
  { name: "overzicht", description: "Korte stand van zaken: lopende gesprekken, verstuurde offertes, openstaande punten.", input_schema: { type: "object", properties: {}, required: [] } },
];

export async function verwerkJosBericht(sb: SupabaseClient, tekst: string, josTelefoon: string) {
  // 1. Snelle route: genummerd akkoord
  const snel = await snelleGoedkeuring(sb, tekst);
  if (snel) {
    const r = snel.resultaat as Record<string, unknown>;
    if (!r.gelukt) return await sendText(josTelefoon, `Lukte niet: ${r.reden}`);
    if (snel.actie === "goedgekeurd") {
      return await sendText(josTelefoon,
        `Genoteerd. EUR ${fmt(Number(r.prijs_min))}${r.prijs_max && r.prijs_max !== r.prijs_min ? ` - ${fmt(Number(r.prijs_max))}` : ""} excl. btw staat nu in de prijslijst.` +
        (r.klant_geinformeerd ? `\n\nIk heb de klant net dit gestuurd:\n"${r.klant_bericht}"` : ""));
    }
    return await sendText(josTelefoon, `Genoteerd, we doen dit niet.` + (r.klant_geinformeerd ? `\n\nIk heb de klant net dit gestuurd:\n"${r.klant_bericht}"` : ""));
  }

  // 2. Vrije tekst via agent
  const { data: open } = await sb.from("prijs_voorstellen").select("id, dienst_naam, voorstel_prijs_min, voorstel_prijs_max, voorstel_eenheid, customer_phone, klant_vraag").eq("status", "open").order("id");
  const { data: review } = await sb.from("needs_review").select("id, customer_phone, reason, customer_message, draft_reply").eq("resolved", false).order("id");

  const system = `Je bent de persoonlijke assistent van Jos (Rotterdam Keukenmontage). Dit is het interne kanaal: je praat met JOS zelf, niet met een klant.

Toon: kort, praktisch, je-vorm, alsof je zijn rechterhand bent. Geen plichtplegingen. Maximaal een paar zinnen.

Jos stuurt je korte opdrachten. Voer ze uit met de tools en bevestig kort wat je gedaan hebt.

Openstaande prijsvoorstellen:
${(open ?? []).length ? (open ?? []).map((v) => `#${v.id} — ${v.dienst_naam} — voorstel EUR ${v.voorstel_prijs_min}-${v.voorstel_prijs_max} excl. btw ${v.voorstel_eenheid ?? ""} — klant +${v.customer_phone}`).join("\n") : "geen"}

Openstaande escalaties:
${(review ?? []).length ? (review ?? []).map((r) => `#${r.id} — +${r.customer_phone} — ${r.reason}`).join("\n") : "geen"}

Als Jos alleen een bedrag of "ja"/"nee" stuurt en er is precies een openstaand voorstel, ga daar dan van uit. Bij twijfel vraag je kort na met het nummer erbij.`;

  const execute = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case "open_voorstellen":
        return { voorstellen: open ?? [], escalaties: review ?? [] };
      case "keur_voorstel_goed":
        return await keurGoed(sb, Number(input.voorstel_id), input.prijs_min as number ?? null, input.prijs_max as number ?? null, input.opmerking as string);
      case "wijs_voorstel_af":
        return await wijsAf(sb, Number(input.voorstel_id), input.reden as string);
      case "zet_dienst_in_prijslijst": {
        const slug = (input.slug as string) || slugify(String(input.naam));
        const { data: bestaand } = await sb.from("prijzen_diensten").select("id").eq("slug", slug).maybeSingle();
        const row: Record<string, unknown> = {
          slug, naam: input.naam, status: (input.status as string) ?? "actief",
          prijsmodel: input.uurtarief ? "per_uur" : (input.prijs_min === input.prijs_max ? "vast" : "bandbreedte"),
          prijs_min: input.prijs_min ?? null, prijs_max: input.prijs_max ?? null,
          eenheid: input.eenheid ?? null, uurtarief: input.uurtarief ?? null,
          toelichting: input.toelichting ?? null, bron: "handmatig", goedgekeurd_op: new Date().toISOString(),
        };
        const { error } = bestaand
          ? await sb.from("prijzen_diensten").update(row).eq("slug", slug)
          : await sb.from("prijzen_diensten").insert(row);
        return error ? { gelukt: false, reden: error.message } : { gelukt: true, slug, nieuw: !bestaand };
      }
      case "toon_prijslijst": {
        const { data } = await sb.from("prijzen_diensten").select("slug, naam, status, prijsmodel, prijs_min, prijs_max, eenheid, minimumbedrag").order("categorie");
        return data ?? [];
      }
      case "stuur_bericht_naar_klant": {
        const t = normPhone(String(input.telefoon));
        const r = await sendText(t, String(input.tekst));
        if (r.ok) await logBericht(sb, t, "outbound", String(input.tekst), null, { door: "jos" });
        return r.ok ? { gelukt: true } : { gelukt: false, reden: r.error };
      }
      case "neem_gesprek_over": {
        const t = normPhone(String(input.telefoon));
        const uren = Number(input.uren ?? 12);
        await sb.from("wa_gesprekken").upsert({
          customer_phone: t, status: "overgenomen",
          pauzeer_tot: new Date(Date.now() + uren * 3600_000).toISOString(),
        }, { onConflict: "customer_phone" });
        return { gelukt: true, tot: `${uren} uur` };
      }
      case "geef_gesprek_terug": {
        const t = normPhone(String(input.telefoon));
        await sb.from("wa_gesprekken").upsert({ customer_phone: t, status: "bot", pauzeer_tot: null }, { onConflict: "customer_phone" });
        return { gelukt: true };
      }
      case "zet_assistent": {
        await sb.from("bot_instellingen").upsert({ key: "actief", waarde: !!input.aan, updated_at: new Date().toISOString() }, { onConflict: "key" });
        return { gelukt: true, actief: !!input.aan };
      }
      case "overzicht": {
        const sinds = new Date(Date.now() - 7 * 86400_000).toISOString();
        const { data: gesprekken } = await sb.from("wa_gesprekken").select("customer_phone, naam, dienst_focus, status, samenvatting, updated_at").gte("updated_at", sinds).order("updated_at", { ascending: false }).limit(20);
        const { count: offertes } = await sb.from("aanvragen").select("id", { count: "exact", head: true }).eq("bron", "whatsapp").gte("aangemaakt_op", sinds);
        return { gesprekken_deze_week: gesprekken ?? [], offertes_via_whatsapp_deze_week: offertes ?? 0, open_voorstellen: open ?? [], open_escalaties: review ?? [] };
      }
    }
    return { fout: `onbekende tool ${name}` };
  };

  const res = await runAgent({
    system,
    messages: [{ role: "user", content: tekst }],
    tools: JOS_TOOLS,
    execute,
    maxTurns: 5,
  });
  await sendText(josTelefoon, res.text || "Gedaan.");
}
