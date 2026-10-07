/**
 * Transportlaag.
 *
 * Fase 1 draait op een wegwerpnummer via Baileys: een gekoppeld apparaat dat
 * een permanente websocket openhoudt. De officiële Cloud API werkt precies
 * andersom — die duwt webhooks naar een serverless functie.
 *
 * Die twee verschillen zo sterk dat de orchestrator er niets van mag weten.
 * Alles wat per kanaal verschilt staat hier; `orchestrator.ts` blijft ongemoeid
 * als je straks overstapt naar het zakelijke nummer.
 *
 * Gevolg voor de hosting: Baileys kan NIET op Vercel. Een serverless functie
 * gaat uit de lucht zodra het antwoord verstuurd is, en dan valt de sessie weg.
 * Dit draait op een kleine VPS (TransIP).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InkomendBericht {
  kanaalSleutel: string;   // phone_number_id (Cloud API) of eigen nummer (Baileys)
  vanNummer: string;
  tekst: string;           // bij media: het bijschrift (kan leeg zijn)
  ontvangenOp: Date;
  media?: InkomendMedia;
}

/** Een foto of bestand van de klant. Downloaden gebeurt pas als het nodig is. */
export interface InkomendMedia {
  soort: 'afbeelding' | 'document' | 'anders';
  mime: string;
  bestandsnaam?: string;
  download(): Promise<Buffer>;
}

export interface Transport {
  naam: 'baileys' | 'cloud_api';
  start(onBericht: (b: InkomendBericht) => Promise<void>): Promise<void>;
  stuur(naar: string, tekst: string): Promise<void>;
  /** Een foto of bestand doorsturen (bijv. de tekening van een klant naar de monteur). */
  stuurBestand(naar: string, bestand: { bytes: Buffer; mime: string; naam: string; bijschrift?: string }): Promise<void>;
  /** Wordt vervuld zodra de verbinding de eerste keer open is. */
  verbonden(): Promise<void>;
  stop(): Promise<void>;
}

// ------------------------------------------------- prototype: wegwerpnummer

/**
 * Baileys-adapter. Bewust minimaal gehouden.
 *
 * Twee dingen om te weten voordat je dit op een nummer aanzet:
 *   1. Dit is geen officiële koppeling. Het nummer kan geblokkeerd worden.
 *      Daarom het wegwerpnummer en niet 06 11911357.
 *   2. De sessie (`authDir`) is de sleutel tot het WhatsApp-account. Niet in
 *      de repo, niet in een backup die je deelt.
 */
export function baileysTransport(opts: {
  authDir: string;
  eigenNummer: string;
  logger?: (m: string) => void;
}): Transport {
  let sock: any;
  let meldVerbonden!: () => void;
  const verbondenBelofte = new Promise<void>((r) => (meldVerbonden = r));
  const log = opts.logger ?? ((m: string) => console.log(`[baileys] ${m}`));

  // Deze drie overleven een herverbinding (ze staan buiten start()).
  //
  // 1. Het adres waarop een klant écht schrijft. Nieuwere WhatsApp-versies
  //    gebruiken een anoniem id (…@lid). Antwoord je dan op 06…@s.whatsapp.net,
  //    dan kan de telefoon van de klant het bericht niet ontsleutelen en ziet
  //    hij "Wachten op dit bericht". Dus: altijd terugschrijven naar het adres
  //    waar het bericht vandaan kwam.
  //    Bewaard in authDir, zodat het een herstart overleeft (anders gaat een
  //    bericht na een update naar het verkeerde adres).
  const adressenBestand = join(opts.authDir, 'adressen.json');
  const adresVan = new Map<string, string>(leesAdressen(adressenBestand));
  // 2. Verstuurde berichten, zodat een telefoon die een bericht niet kon
  //    ontsleutelen het opnieuw kan opvragen (getMessage).
  const verstuurd = new Map<string, unknown>();
  // 3. Teller voor die herhaalverzoeken.
  const retryTeller = maakCache();

  return {
    naam: 'baileys',

    async start(onBericht) {
      const {
        default: makeWASocket,
        useMultiFileAuthState,
        makeCacheableSignalKeyStore,
        DisconnectReason,
        downloadMediaMessage,
        normalizeMessageContent,
      } = await import('@whiskeysockets/baileys');

      const { state, saveCreds } = await useMultiFileAuthState(opts.authDir);
      sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys) },
        msgRetryCounterCache: retryTeller,
        getMessage: async (key: any) => verstuurd.get(key.id) as any,
      });

      sock.ev.on('creds.update', saveCreds);

      // Eerste keer: koppelen met een code in plaats van een QR-code. Een QR
      // tekent niet betrouwbaar in een SSH-venster; een code van acht tekens
      // typ je gewoon over in WhatsApp → Gekoppelde apparaten → Koppelen met
      // telefoonnummer.
      if (!state.creds.registered) {
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(opts.eigenNummer);
            log(`KOPPELCODE: ${code}  (WhatsApp → Gekoppelde apparaten → Koppelen met telefoonnummer)`);
          } catch (e) {
            log(`koppelcode aanvragen mislukt: ${String(e)}`);
          }
        }, 3_000);
      }

      sock.ev.on('connection.update', (u: any) => {
        if (u.connection === 'open') {
          log('verbonden');
          meldVerbonden();
        }
        if (u.connection === 'close') {
          const code = u.lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            log('uitgelogd — koppel het apparaat opnieuw');
            return;
          }
          log('verbinding weg, opnieuw proberen');
          setTimeout(() => this.start(onBericht), 5_000);
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
        if (type !== 'notify') return;

        for (const m of messages) {
          if (m.key.fromMe) continue;
          const jid: string = m.key.remoteJid ?? '';
          if (jid.endsWith('@g.us')) continue;          // geen groepen
          if (jid === 'status@broadcast') continue;     // geen statusupdates
          if (jid.endsWith('@newsletter')) continue;    // geen kanalen

          // Tijdelijke berichten, "eenmalig bekijken" en documenten met
          // bijschrift zitten in een omhulsel; normalize haalt dat eraf.
          const inhoud: any = normalizeMessageContent(m.message) ?? {};
          const beeld = inhoud.imageMessage;
          const doc = inhoud.documentMessage;
          const overigMedia =
            inhoud.videoMessage ?? inhoud.audioMessage ?? inhoud.stickerMessage;

          const tekst: string =
            inhoud.conversation ??
            inhoud.extendedTextMessage?.text ??
            beeld?.caption ??
            doc?.caption ??
            '';

          let media: InkomendMedia | undefined;
          if (beeld || doc || overigMedia) {
            const bron = beeld ?? doc ?? overigMedia;
            media = {
              soort: beeld ? 'afbeelding' : doc ? 'document' : 'anders',
              mime: String(bron.mimetype ?? '').split(';')[0].trim().toLowerCase(),
              bestandsnaam: doc?.fileName ?? undefined,
              download: () =>
                downloadMediaMessage(m, 'buffer', {}, {
                  logger: sock.logger,
                  reuploadRequest: sock.updateMediaMessage,
                }) as Promise<Buffer>,
            };
          }

          if (!tekst.trim() && !media) continue;

          const vanNummer = (m.key.senderPn ?? jid)
            .replace(/@s\.whatsapp\.net$/, '')
            .replace(/:\d+$/, '');
          if (adresVan.get(vanNummer) !== jid) {
            adresVan.set(vanNummer, jid);
            bewaarAdressen(adressenBestand, adresVan);
          }
          log(`bericht van ${vanNummer} via ${jid}${media ? ` (${media.soort})` : ''}`);

          try {
            await onBericht({
              kanaalSleutel: opts.eigenNummer,
              // Nieuwere WhatsApp-versies sturen soms een anoniem id (@lid) in
              // plaats van het nummer; senderPn bevat dan het echte nummer.
              vanNummer,
              tekst,
              media,
              ontvangenOp: new Date((Number(m.messageTimestamp) || 0) * 1000),
            });
          } catch (e) {
            // Een fout mag de verbinding nooit omleggen; de klant krijgt dan
            // niets en de monteur weet van niets. Daarom expliciet loggen.
            log(`verwerken mislukt: ${String(e)}`);
          }
        }
      });
    },

    async stuur(naar, tekst) {
      const jid = naar.includes('@') ? naar : adresVan.get(naar) ?? `${naar}@s.whatsapp.net`;
      // Even wachten voor verzenden: direct antwoorden binnen een seconde valt
      // op als bot, zowel bij de klant als bij WhatsApp zelf.
      await new Promise((r) => setTimeout(r, 1_500 + Math.random() * 2_500));
      const msg = await sock.sendMessage(jid, { text: tekst });
      log(`verstuurd naar ${jid}`);
      if (msg?.key?.id) {
        verstuurd.set(msg.key.id, msg.message);
        if (verstuurd.size > 1000) verstuurd.delete(verstuurd.keys().next().value!);
      }
    },

    async stuurBestand(naar, { bytes, mime, naam, bijschrift }) {
      const jid = naar.includes('@') ? naar : adresVan.get(naar) ?? `${naar}@s.whatsapp.net`;
      // Foto's als foto (direct zichtbaar), de rest als document met naam.
      const inhoud = ['image/jpeg', 'image/png'].includes(mime)
        ? { image: bytes, mimetype: mime, caption: bijschrift }
        : { document: bytes, mimetype: mime || 'application/octet-stream', fileName: naam, caption: bijschrift };
      const msg = await sock.sendMessage(jid, inhoud);
      log(`bestand verstuurd naar ${jid} (${naam})`);
      if (msg?.key?.id) {
        verstuurd.set(msg.key.id, msg.message);
        if (verstuurd.size > 1000) verstuurd.delete(verstuurd.keys().next().value!);
      }
    },

    verbonden() {
      return verbondenBelofte;
    },

    async stop() {
      await sock?.end?.();
    },
  };
}

function leesAdressen(bestand: string): [string, string][] {
  try {
    return Object.entries(JSON.parse(readFileSync(bestand, 'utf8')) as Record<string, string>);
  } catch {
    return [];
  }
}

function bewaarAdressen(bestand: string, m: Map<string, string>) {
  try {
    writeFileSync(bestand, JSON.stringify(Object.fromEntries(m)));
  } catch (e) {
    console.error(`[baileys] adressen bewaren mislukt: ${String(e)}`);
  }
}

/** Eenvoudige cache volgens Baileys' CacheStore-vorm, zonder extra pakket. */
function maakCache() {
  const m = new Map<string, unknown>();
  return {
    get: <T>(k: string) => m.get(k) as T | undefined,
    set: <T>(k: string, v: T) => {
      m.set(k, v);
      if (m.size > 5000) m.delete(m.keys().next().value!);
    },
    del: (k: string) => void m.delete(k),
    flushAll: () => m.clear(),
  };
}
