// WhatsApp Cloud API helpers + Meta webhook-signature verificatie.

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v26.0";

export function waConfig() {
  return {
    token: Deno.env.get("WHATSAPP_TOKEN") ?? "",
    phoneNumberId: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "",
    appSecret: Deno.env.get("META_APP_SECRET") ?? "",
    verifyToken: Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "",
  };
}

/** Normaliseert een telefoonnummer naar wa_id-formaat: alleen cijfers, geen +. */
export function normPhone(input: string | null | undefined): string {
  if (!input) return "";
  let d = String(input).replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("06") && d.length === 10) d = "31" + d.slice(1);
  if (d.startsWith("6") && d.length === 9) d = "31" + d;
  return d;
}

/** Splitst lange tekst in WhatsApp-vriendelijke brokken (<= 3500 tekens). */
function splitMessage(text: string, max = 3500): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export type SendResult = {
  ok: boolean;
  needsTemplate: boolean;
  error?: string;
  ids: string[];
};

/** Verstuurt een tekstbericht via de WhatsApp Cloud API. */
export async function sendText(to: string, body: string): Promise<SendResult> {
  const { token, phoneNumberId } = waConfig();
  const ids: string[] = [];
  if (!token || !phoneNumberId) {
    return { ok: false, needsTemplate: false, error: "WHATSAPP_TOKEN of WHATSAPP_PHONE_NUMBER_ID ontbreekt", ids };
  }
  const chunks = splitMessage(body);
  for (const chunk of chunks) {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normPhone(to),
        type: "text",
        text: { preview_url: true, body: chunk },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = json?.error?.code;
      // 131047 = re-engagement required (buiten 24-uursvenster)
      // 131026 = message undeliverable
      const needsTemplate = code === 131047 || code === 131051;
      console.error("WhatsApp send fout:", JSON.stringify(json));
      return { ok: false, needsTemplate, error: json?.error?.message ?? `HTTP ${res.status}`, ids };
    }
    const id = json?.messages?.[0]?.id;
    if (id) ids.push(id);
  }
  return { ok: true, needsTemplate: false, ids };
}

/** Markeert een inkomend bericht als gelezen (blauwe vinkjes = persoonlijk gevoel). */
export async function markRead(messageId: string): Promise<void> {
  const { token, phoneNumberId } = waConfig();
  if (!token || !phoneNumberId || !messageId) return;
  try {
    await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
    });
  } catch (e) {
    console.error("markRead fout:", e);
  }
}

/** Verificatie van de X-Hub-Signature-256 header van Meta. */
export async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  const { appSecret } = waConfig();
  if (!appSecret) return true; // niet geconfigureerd -> overslaan
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = header.slice(7).toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Fallback-notificatie per e-mail wanneer WhatsApp naar Jos niet lukt. */
export async function mailOwner(subject: string, html: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("OWNER_EMAIL") ?? "maartendejongejonge@gmail.com";
  if (!key) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Rotterdam Keukenmontage <info@rotterdam-keukenmontage.nl>",
        to,
        subject,
        html,
      }),
    });
  } catch (e) {
    console.error("mailOwner fout:", e);
  }
}
