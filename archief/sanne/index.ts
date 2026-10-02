// =====================================================================
// whatsapp-webhook — persoonlijke WhatsApp-assistent van Rotterdam Keukenmontage
//
// GET  : Meta webhook-verificatie (hub.challenge)
// POST : inkomende WhatsApp-berichten
//        - van een klant  -> assistent beantwoordt (tools: prijs, offerte, plannen)
//        - van Jos zelf   -> interne commando's (goedkeuren prijzen, overnemen)
//        - {simuleer:true}-> testmodus met service-role key, stuurt niets naar WhatsApp
//        - {test_token}   -> testmodus: bestand uitlezen of gesprek simuleren, stuurt en bewaart niets
//        Foto's en PDF's van klanten worden uitgelezen (media.ts) en als tekst in het gesprek gezet.
// =====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySignature, waConfig, normPhone, markRead, sendText } from "./whatsapp.ts";
import { antwoordKlant, logBericht, laadInstellingen, bouwSysteemPrompt, KLANT_TOOLS, maakExecutor } from "./agent.ts";
import { runAgent, type Msg } from "./llm.ts";
import { leesBestand, mediaNaarTekst } from "./media.ts";
import { decode as b64decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { verwerkJosBericht } from "./owner.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Geheim token voor de testmodus (bestand uitlezen / gesprek simuleren zonder WhatsApp).
const TEST_TOKEN = "<verwijderd>";

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// --- kern: één inkomend bericht verwerken -----------------------------
async function verwerkBericht(van: string, tekst: string, waId: string | null, profielNaam: string | null, simuleer = false): Promise<string> {
  const client = sb();
  const inst = await laadInstellingen(client);
  const eigenaar = normPhone(String(inst["eigenaar_telefoon"] ?? ""));
  const telefoon = normPhone(van);

  // Bericht van Jos zelf -> intern kanaal
  if (telefoon && telefoon === eigenaar) {
    await verwerkJosBericht(client, tekst, telefoon);
    return "(intern bericht van Jos verwerkt)";
  }

  // Idempotentie + logging van het klantbericht
  const nieuw = await logBericht(client, telefoon, "inbound", tekst, waId);
  if (!nieuw && waId) {
    console.log(`Dubbel bericht ${waId} genegeerd`);
    return "(dubbel)";
  }

  // Assistent uit?
  if (inst["actief"] === false) {
    console.log("Assistent staat uit; alleen gelogd.");
    return "(assistent uit)";
  }

  // Gespreksstatus: heeft Jos het overgenomen?
  const { data: gesprek } = await client.from("wa_gesprekken")
    .select("status, pauzeer_tot, naam").eq("customer_phone", telefoon).maybeSingle();

  if (!gesprek) {
    await client.from("wa_gesprekken").insert({
      customer_phone: telefoon,
      naam: profielNaam ?? null,
      laatste_klant_bericht_op: new Date().toISOString(),
    });
    await client.from("whatsapp_leads").upsert(
      { customer_phone: telefoon, name: profielNaam ?? null, stage: "new" },
      { onConflict: "customer_phone" },
    );
  } else {
    await client.from("wa_gesprekken").update({
      laatste_klant_bericht_op: new Date().toISOString(),
      ...(profielNaam && !gesprek.naam ? { naam: profielNaam } : {}),
    }).eq("customer_phone", telefoon);
  }

  const overgenomen = gesprek?.status === "overgenomen" &&
    (!gesprek.pauzeer_tot || new Date(gesprek.pauzeer_tot as string) > new Date());
  if (overgenomen) {
    const { data: inst2 } = await client.from("bot_instellingen").select("waarde").eq("key", "eigenaar_telefoon").maybeSingle();
    const jos = normPhone(String(inst2?.waarde ?? ""));
    if (jos && !simuleer) await sendText(jos, `Bericht van +${telefoon}${gesprek?.naam ? ` (${gesprek.naam})` : ""}:\n\n"${tekst}"\n\n(jij hebt dit gesprek overgenomen — ik antwoord niet)`);
    return "(overgenomen door Jos)";
  }

  if (gesprek?.status === "geblokkeerd") return "(geblokkeerd)";

  return await antwoordKlant(client, telefoon);
}

serve(async (req) => {
  const url = new URL(req.url);

  // ---- Meta webhook-verificatie -------------------------------------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const { verifyToken } = waConfig();
    if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
      return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();

  // ---- Testmodus (alleen met service-role key) ----------------------
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return ok({ error: "ongeldige JSON" }, 400);
  }

  // ---- Testmodus met token: niets naar WhatsApp, niets opgeslagen ---
  if (payload?.test_token === TEST_TOKEN) {
    try {
      if (payload.modus === "bestand") {
        const tekst = await leesBestand({ bytes: b64decode(String(payload.data)), mime: String(payload.mime) }, String(payload.bijschrift ?? ""));
        return ok({ ok: true, tekst });
      }
      const client = sb();
      const inst = await laadInstellingen(client);
      const system = await bouwSysteemPrompt(client, inst, null);
      const echt = maakExecutor(client, "31600000000", inst);
      const r = await runAgent({
        system,
        messages: payload.berichten as Msg[],
        tools: KLANT_TOOLS,
        execute: async (name, input) => name === "bereken_prijs" ? await echt(name, input) : { gelukt: true, test: "niet uitgevoerd in testmodus" },
      });
      return ok({ ok: true, ...r });
    } catch (e) {
      return ok({ ok: false, fout: String(e) }, 500);
    }
  }

  if (payload?.simuleer === true) {
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.includes(SERVICE_KEY)) return new Response("Unauthorized", { status: 401 });
    try {
      const antwoord = await verwerkBericht(
        String(payload.van ?? ""),
        String(payload.tekst ?? ""),
        null,
        (payload.naam as string) ?? null,
        true,
      );
      return ok({ ok: true, antwoord });
    } catch (e) {
      console.error("Simulatiefout:", e);
      return ok({ ok: false, fout: String(e) }, 500);
    }
  }

  // ---- Echte Meta-webhook -------------------------------------------
  const geldig = await verifySignature(raw, req.headers.get("x-hub-signature-256"));
  if (!geldig) {
    console.error("Ongeldige webhook-signature");
    return new Response("Forbidden", { status: 403 });
  }

  const taak = (async () => {
    try {
      const entries = (payload?.entry ?? []) as Record<string, unknown>[];
      for (const entry of entries) {
        for (const change of (entry.changes ?? []) as Record<string, unknown>[]) {
          const value = (change.value ?? {}) as Record<string, unknown>;
          const contacts = (value.contacts ?? []) as Record<string, unknown>[];
          const berichten = (value.messages ?? []) as Record<string, unknown>[];
          for (const m of berichten) {
            const van = String(m.from ?? "");
            const waId = String(m.id ?? "") || null;
            const profiel = (contacts?.[0]?.profile as Record<string, unknown> | undefined)?.name as string | undefined;
            if (waId) markRead(waId).catch(() => {});

            let tekst = "";
            if (m.type === "text") tekst = String((m.text as Record<string, unknown>)?.body ?? "");
            else if (m.type === "button") tekst = String((m.button as Record<string, unknown>)?.text ?? "");
            else if (m.type === "interactive") {
              const i = m.interactive as Record<string, unknown>;
              tekst = String((i?.button_reply as Record<string, unknown>)?.title ?? (i?.list_reply as Record<string, unknown>)?.title ?? "");
            } else if (["image", "document"].includes(String(m.type))) {
              // Foto's en PDF's (onderdelenlijst, plattegrond) laten uitlezen
              tekst = await mediaNaarTekst(String(m.type), m[String(m.type)] as Record<string, unknown> | undefined);
            } else if (["video", "audio", "voice", "sticker"].includes(String(m.type))) {
              const caption = ((m[String(m.type)] as Record<string, unknown>)?.caption as string) ?? "";
              tekst = `[klant stuurde een ${m.type}${caption ? `: "${caption}"` : ""}]`;
            } else if (m.type === "location") {
              const l = m.location as Record<string, unknown>;
              tekst = `[locatie gedeeld: ${l?.name ?? ""} ${l?.address ?? ""}]`;
            } else {
              tekst = `[bericht van type ${m.type}]`;
            }
            if (!tekst) continue;

            await verwerkBericht(van, tekst, waId, profiel ?? null);
          }
        }
      }
    } catch (e) {
      console.error("Verwerkingsfout:", e);
    }
  })();

  // Meta wil binnen enkele seconden een 200; de rest draait door op de achtergrond.
  try {
    // @ts-ignore EdgeRuntime is beschikbaar in Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(taak);
    else await taak;
  } catch {
    await taak;
  }

  return ok();
});
