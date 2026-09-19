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
 * Dit draait op de mini-pc thuis of op een kleine VPS.
 */

export interface InkomendBericht {
  kanaalSleutel: string;   // phone_number_id (Cloud API) of eigen nummer (Baileys)
  vanNummer: string;
  tekst: string;
  ontvangenOp: Date;
}

export interface Transport {
  naam: 'baileys' | 'cloud_api';
  start(onBericht: (b: InkomendBericht) => Promise<void>): Promise<void>;
  stuur(naar: string, tekst: string): Promise<void>;
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
  const log = opts.logger ?? ((m: string) => console.log(`[baileys] ${m}`));

  return {
    naam: 'baileys',

    async start(onBericht) {
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } =
        await import('@whiskeysockets/baileys');

      const { state, saveCreds } = await useMultiFileAuthState(opts.authDir);
      sock = makeWASocket({ auth: state, printQRInTerminal: true });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (u: any) => {
        if (u.connection === 'open') log('verbonden');
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
          if (m.key.remoteJid?.endsWith('@g.us')) continue; // geen groepen

          const tekst =
            m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? '';
          if (!tekst.trim()) continue;

          try {
            await onBericht({
              kanaalSleutel: opts.eigenNummer,
              vanNummer: (m.key.remoteJid ?? '').replace(/@s\.whatsapp\.net$/, ''),
              tekst,
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
      const jid = naar.includes('@') ? naar : `${naar}@s.whatsapp.net`;
      // Even wachten voor verzenden: direct antwoorden binnen een seconde valt
      // op als bot, zowel bij de klant als bij WhatsApp zelf.
      await new Promise((r) => setTimeout(r, 1_500 + Math.random() * 2_500));
      await sock.sendMessage(jid, { text: tekst });
    },

    async stop() {
      await sock?.end?.();
    },
  };
}
