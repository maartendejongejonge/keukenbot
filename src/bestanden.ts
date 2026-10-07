/**
 * Bestanden van klanten bewaren, zodat de monteur ze zelf kan bekijken.
 *
 * De bot leest foto's en PDF's uit (media.ts) en werkt verder met die
 * samenvatting. De monteur heeft daar niets aan als hij moet meekijken: hij
 * wil de tekening zelf zien. Daarom bewaart de runner elk bestand op schijf
 * en stuurt het mee bij een seintje, overdracht of inplanning.
 *
 * Per klantnummer een map met de bestanden en een index.json. Niet in de
 * database: dit zijn klantgegevens die alleen de runner nodig heeft, en de
 * VPS-schijf is groot genoeg. Na BEWAAR_DAGEN worden ze opgeruimd.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = process.env.BESTANDEN_DIR ?? '/opt/keukenbot/bestanden';
const BEWAAR_DAGEN = 60;
const MAX_BYTES = 50 * 1024 * 1024;

export interface KlantBestand {
  id: string;
  soort: 'afbeelding' | 'document' | 'anders';
  mime: string;
  naam: string;
  op: string;              // ISO-tijd van ontvangst
  verstuurd: boolean;      // al naar de monteur gestuurd
}

const mapVan = (nummer: string) => join(MAP, nummer.replace(/[^0-9a-zA-Z@._-]/g, '_'));
const indexVan = (nummer: string) => join(mapVan(nummer), 'index.json');

function leesIndex(nummer: string): KlantBestand[] {
  try {
    return JSON.parse(readFileSync(indexVan(nummer), 'utf8'));
  } catch {
    return [];
  }
}

function schrijfIndex(nummer: string, lijst: KlantBestand[]) {
  writeFileSync(indexVan(nummer), JSON.stringify(lijst, null, 1));
}

const EXTENSIE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
};

/** Bewaart een bestand. Faalt nooit: een fout wordt gelogd. */
export function bewaarBestand(
  nummer: string,
  bytes: Buffer,
  info: { soort: KlantBestand['soort']; mime: string; bestandsnaam?: string },
): KlantBestand | null {
  try {
    if (bytes.length > MAX_BYTES) {
      console.warn(`bestand van ${nummer} te groot om te bewaren (${bytes.length} bytes)`);
      return null;
    }
    mkdirSync(mapVan(nummer), { recursive: true, mode: 0o700 });
    const op = new Date();
    const id = `${op.getTime()}-${Math.random().toString(36).slice(2, 7)}`;
    const ext = EXTENSIE[info.mime] ?? info.bestandsnaam?.split('.').pop() ?? 'bin';
    const naam = info.bestandsnaam || `${info.soort === 'afbeelding' ? 'foto' : 'bestand'}-${op.toISOString().slice(0, 16).replace('T', '-').replace(':', '')}.${ext}`;
    writeFileSync(join(mapVan(nummer), id), bytes, { mode: 0o600 });
    const rij: KlantBestand = { id, soort: info.soort, mime: info.mime, naam, op: op.toISOString(), verstuurd: false };
    schrijfIndex(nummer, [...leesIndex(nummer), rij]);
    return rij;
  } catch (e) {
    console.error(`bestand bewaren mislukt (${nummer}):`, String(e));
    return null;
  }
}

/** Bestanden van deze klant vanaf `sinds` (begin van het gesprek; een kwartier speling, want het bestand komt binnen vóór de lead bestaat). */
export function bestandenVan(nummer: string, sinds?: Date, alleenNieuw = false): KlantBestand[] {
  return leesIndex(nummer).filter((b) =>
    (!sinds || +new Date(b.op) >= +sinds - 15 * 60_000) && (!alleenNieuw || !b.verstuurd),
  );
}

export function leesBytes(nummer: string, b: KlantBestand): Buffer {
  return readFileSync(join(mapVan(nummer), b.id));
}

export function markeerVerstuurd(nummer: string, ids: string[]) {
  if (!ids.length) return;
  try {
    schrijfIndex(nummer, leesIndex(nummer).map((b) => (ids.includes(b.id) ? { ...b, verstuurd: true } : b)));
  } catch (e) {
    console.error(`index bijwerken mislukt (${nummer}):`, String(e));
  }
}

/** Alles van één klant weg (reset van een tester). */
export function wisBestanden(nummer: string) {
  try {
    rmSync(mapVan(nummer), { recursive: true, force: true });
  } catch (e) {
    console.error(`bestanden wissen mislukt (${nummer}):`, String(e));
  }
}

/** Bestanden ouder dan BEWAAR_DAGEN verwijderen. */
export function ruimBestandenOp() {
  let mappen: string[];
  try {
    mappen = readdirSync(MAP);
  } catch {
    return;
  }
  const grens = Date.now() - BEWAAR_DAGEN * 86_400_000;
  for (const m of mappen) {
    try {
      const pad = join(MAP, m);
      if (!statSync(pad).isDirectory()) continue;
      const lijst: KlantBestand[] = JSON.parse(readFileSync(join(pad, 'index.json'), 'utf8'));
      const blijft = lijst.filter((b) => +new Date(b.op) >= grens);
      for (const b of lijst) if (!blijft.includes(b)) rmSync(join(pad, b.id), { force: true });
      if (!blijft.length) rmSync(pad, { recursive: true, force: true });
      else if (blijft.length !== lijst.length) writeFileSync(join(pad, 'index.json'), JSON.stringify(blijft, null, 1));
    } catch {
      // map zonder index of half geschreven: overslaan
    }
  }
}
