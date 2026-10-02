// =====================================================================
// bot-admin — bedieningspaneel voor de WhatsApp-assistent
// GET  : serveert de webpagina (login met wachtwoord)
// POST : JSON-API, beveiligd met header x-admin-wachtwoord
// =====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { antwoordKlant, logBericht } from "./agent.ts";
import { verwerkJosBericht } from "./owner.ts";
import { HTML } from "./page.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WACHTWOORD = Deno.env.get("ADMIN_WACHTWOORD") ?? "";
const TESTNUMMER = "000000000000";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-wachtwoord",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method === "GET") {
    return new Response(HTML, { headers: { ...cors, "Content-Type": "text/html; charset=utf-8" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const wachtwoord = req.headers.get("x-admin-wachtwoord") ?? "";
  if (!WACHTWOORD) return json({ fout: "ADMIN_WACHTWOORD is nog niet ingesteld in Supabase." }, 500);
  if (wachtwoord !== WACHTWOORD) return json({ fout: "Onjuist wachtwoord" }, 401);

  const client = sb();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ fout: "ongeldige JSON" }, 400); }
  const actie = String(body.actie ?? "");

  try {
    switch (actie) {
      case "overzicht": {
        const [prijzen, voorstellen, gesprekken, instellingen, acties] = await Promise.all([
          client.from("prijzen_diensten").select("*").order("status").order("naam"),
          client.from("prijs_voorstellen").select("*").order("id", { ascending: false }).limit(40),
          client.from("wa_gesprekken").select("*").order("updated_at", { ascending: false }).limit(40),
          client.from("bot_instellingen").select("*").order("key"),
          client.from("bot_offers").select("*").order("id"),
        ]);
        return json({
          prijzen: prijzen.data ?? [], voorstellen: voorstellen.data ?? [],
          gesprekken: gesprekken.data ?? [], instellingen: instellingen.data ?? [], acties: acties.data ?? [],
        });
      }

      case "gesprek": {
        const { data } = await client.from("message_log").select("direction, body, created_at")
          .eq("customer_phone", String(body.telefoon)).order("created_at").limit(200);
        return json({ berichten: data ?? [] });
      }

      case "prijs_opslaan": {
        const r = body.rij as Record<string, unknown>;
        const velden = ["slug", "naam", "categorie", "status", "prijsmodel", "prijs_min", "prijs_max", "eenheid",
          "uurtarief", "minimumbedrag", "geschatte_tijd_minuten", "toelichting", "calculator_dienst_type", "aliassen", "vragen"];
        const row: Record<string, unknown> = {};
        for (const v of velden) if (v in r) row[v] = r[v] === "" ? null : r[v];
        if (!row.slug || !row.naam) return json({ fout: "slug en naam zijn verplicht" }, 400);
        if (row.status === "actief") row.goedgekeurd_op = new Date().toISOString();
        const { error } = await client.from("prijzen_diensten").upsert(row, { onConflict: "slug" });
        return error ? json({ fout: error.message }, 400) : json({ ok: true });
      }

      case "prijs_verwijderen": {
        const { error } = await client.from("prijzen_diensten").update({ status: "gearchiveerd" }).eq("slug", String(body.slug));
        return error ? json({ fout: error.message }, 400) : json({ ok: true });
      }

      case "voorstel_afhandelen": {
        // hergebruik exact dezelfde logica als via WhatsApp
        const id = Number(body.id);
        const akkoord = body.akkoord === true;
        const min = body.prijs_min != null ? Number(body.prijs_min) : null;
        const max = body.prijs_max != null ? Number(body.prijs_max) : null;
        const tekst = akkoord
          ? `${id} ja${min != null ? ` ${min}${max != null && max !== min ? `-${max}` : ""}` : ""}`
          : `${id} nee ${String(body.reden ?? "")}`.trim();
        await verwerkJosBericht(client, tekst, "");
        const { data } = await client.from("prijs_voorstellen").select("*").eq("id", id).maybeSingle();
        return json({ ok: true, voorstel: data });
      }

      case "instelling_opslaan": {
        const { error } = await client.from("bot_instellingen")
          .upsert({ key: String(body.key), waarde: body.waarde, updated_at: new Date().toISOString() }, { onConflict: "key" });
        return error ? json({ fout: error.message }, 400) : json({ ok: true });
      }

      case "actie_opslaan": {
        const r = body.rij as Record<string, unknown>;
        const { error } = await client.from("bot_offers").upsert({
          slug: r.slug, title: r.title, description: r.description, conditions: r.conditions ?? null,
          active: r.active === true, valid_until: r.valid_until || null,
        }, { onConflict: "slug" });
        return error ? json({ fout: error.message }, 400) : json({ ok: true });
      }

      case "test_chat": {
        const tekst = String(body.tekst ?? "");
        if (body.reset === true) {
          await client.from("message_log").delete().eq("customer_phone", TESTNUMMER);
          await client.from("wa_gesprekken").delete().eq("customer_phone", TESTNUMMER);
          if (!tekst) return json({ ok: true, antwoord: "(gesprek gewist)" });
        }
        await client.from("wa_gesprekken").upsert({ customer_phone: TESTNUMMER, naam: "Testklant" }, { onConflict: "customer_phone" });
        await logBericht(client, TESTNUMMER, "inbound", tekst);
        const antwoord = await antwoordKlant(client, TESTNUMMER);
        return json({ ok: true, antwoord });
      }

      case "gesprek_overnemen": {
        const uren = Number(body.uren ?? 12);
        await client.from("wa_gesprekken").upsert({
          customer_phone: String(body.telefoon),
          status: body.terug === true ? "bot" : "overgenomen",
          pauzeer_tot: body.terug === true ? null : new Date(Date.now() + uren * 3600_000).toISOString(),
        }, { onConflict: "customer_phone" });
        return json({ ok: true });
      }
    }
    return json({ fout: `onbekende actie ${actie}` }, 400);
  } catch (e) {
    console.error("bot-admin fout:", e);
    return json({ fout: String(e) }, 500);
  }
});
