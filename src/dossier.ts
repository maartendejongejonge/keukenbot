/**
 * Het dossier dat de monteur krijgt als Pico een klant aan hem doorgeeft
 * (overdracht of inplanning). Gevraagd door Maarten op 28-10-2026: "een
 * samenvatting van de opdracht, inclusief foto's en bestanden".
 *
 * Volgorde van de berichten aan de monteur (zie runner.ts, dossierNaarMonteur):
 *   1. dit dossier: wie, wat, waar, prijs, waarom bij jou, korte samenvatting
 *   2. de foto's en bestanden van de klant, elk met een bijschrift
 *   3. het volledige gesprek, als naslag
 *
 * Alles hieronder komt uit de lead (wat de bot al wist). Alleen de korte
 * gesprekssamenvatting komt van het model; mislukt die, dan valt hij weg.
 */

import { berekenService, zoneVoor } from './service.js';
import type { KlantBestand } from './bestanden.js';

export interface DossierInvoer {
  /** bovenste regel, bijv. "Overdracht — zwaar werkblad" of "Ingepland — klusje do 29 okt 07:30" */
  kop: string;
  /** de leadrij uit de database */
  lead: any;
  /** waarom de klant bij de monteur komt (zonder "Reden: … Bekend: …") */
  aanleiding?: string;
  /** voorgesteld antwoord of offertetekst */
  concept?: string;
  /** extra regels, bijv. "Staat in je Google Agenda." */
  extra?: string[];
  laatsteKlantbericht?: string;
  /** korte samenvatting van het gesprek door het model */
  samenvatting?: string | null;
  bestanden: KlantBestand[];
  /** waarvan er nu meegestuurd worden (de rest had de monteur al) */
  nieuweBestanden: number;
}

const SOORT: Record<string, string> = {
  montage: 'keukenmontage',
  service: 'serviceklus',
  reparatie: 'serviceklus',
  ombouw: 'serviceklus',
  losse_kast: 'serviceklus',
  klusje: 'klusje buiten de keuken',
};

function euro(n: number): string {
  return `€ ${Math.round(n).toLocaleString('nl-NL')}`;
}

function lijst(xs: unknown): string | null {
  return Array.isArray(xs) && xs.length ? xs.filter(Boolean).join(', ') : null;
}

/** Wat er moet gebeuren, in regels. Ook gebruikt in de melding bij een voorstel. */
export function watRegels(lead: any): string[] {
  const w = lead.werk ?? {};
  const uit: string[] = [];

  const service = Array.isArray(w._service) ? w._service : [];
  if (service.length) {
    const b = berekenService(service);
    for (const r of b.regels) uit.push(`- ${r.omschrijving}${r.aantal > 1 ? ` (${r.aantal}×)` : ''}: ${euro(r.bedrag)}`);
    if (b.onbekend.length) uit.push(`- zonder staffelprijs: ${b.onbekend.join(', ')}`);
    uit.push(`  arbeid ${euro(b.arbeid)} incl. btw, ± ${Math.round(b.duurMin / 6) / 10} uur`);
  }

  const kasten = (w.onderkasten ?? 0) + (w.hangkasten ?? 0) + (w.hoge_kasten ?? 0);
  if (kasten) {
    const delen = [
      w.onderkasten ? `${w.onderkasten} onder` : null,
      w.hangkasten ? `${w.hangkasten} hang` : null,
      w.hoge_kasten ? `${w.hoge_kasten} hoog` : null,
    ].filter(Boolean).join(', ');
    uit.push(`- ${kasten} kasten (${delen})${w.levering ? `, ${w.levering}` : ''}${w.opstelling ? `, opstelling ${w.opstelling}` : ''}`);
  }
  if (lijst(w.waterpunten)) uit.push(`- water: ${lijst(w.waterpunten)}`);
  if (lijst(w.apparaten)) uit.push(`- apparaten: ${lijst(w.apparaten)}`);
  if (lead.werkblad_door) uit.push(`- werkblad door: ${lead.werkblad_door}${w.zwaar_werkblad ? ' (zwaar blad)' : ''}`);
  if (lijst(w.overig)) uit.push(`- extra werk zonder vaste prijs: ${lijst(w.overig)}`);
  if (lead.omvang) uit.push(`- ${lead.omvang}`);
  if (lead.klusjes) uit.push(`- ${lead.klusjes}`);
  if (lijst(lead.installatiewerk)) uit.push(`- installatiewerk: ${lijst(lead.installatiewerk)}`);
  return uit;
}

function waarRegel(lead: any): string | null {
  const plaats = lead.plaats?.trim();
  const delen: string[] = [];
  if (plaats) {
    const z = zoneVoor(plaats);
    delen.push(`${plaats}${z.status === 'gratis' ? ' (reis gratis)' : z.status === 'betaald' ? ' (reiskosten)' : ' (regio nog niet beoordeeld)'}`);
  }
  if (lead.pc4) delen.push(String(lead.pc4));
  if (lead.verdieping != null) delen.push(`${lead.verdieping === 0 ? 'begane grond' : `${lead.verdieping}e verdieping`}${lead.lift === false ? ', geen lift' : lead.lift ? ', met lift' : ''}`);
  return delen.length ? `Waar: ${delen.join(' · ')}` : null;
}

function bijlagenRegel(bestanden: KlantBestand[], nieuw: number): string {
  if (!bestanden.length) return 'Bijlagen: geen foto\'s of bestanden ontvangen.';
  const fotos = bestanden.filter((b) => b.soort === 'afbeelding').length;
  const docs = bestanden.filter((b) => b.soort === 'document').length;
  const rest = bestanden.length - fotos - docs;
  const delen = [
    fotos ? `${fotos} foto${fotos > 1 ? "'s" : ''}` : null,
    docs ? `${docs} document${docs > 1 ? 'en' : ''}` : null,
    rest ? `${rest} overig (video/spraak)` : null,
  ].filter(Boolean).join(', ');
  const eerder = bestanden.length - nieuw;
  return `Bijlagen: ${delen}` + (nieuw ? ' — hieronder' : '') + (eerder ? ` (${eerder} had je al eerder gekregen)` : '') + '.';
}

export function maakDossier(d: DossierInvoer): string {
  const l = d.lead;
  const blokken: (string | null)[] = [
    d.kop,
    [
      `Klant: ${l.klant_naam ? `${l.klant_naam}, ` : ''}${l.klant_telefoon ?? ''}`.trim(),
      l.type_klus ? `Klus: ${SOORT[l.type_klus] ?? l.type_klus}` : null,
      waarRegel(l),
      l.leverancier ? `Leverancier: ${l.leverancier}${l.tweedehands ? ' (tweedehands)' : ''}` : l.tweedehands ? 'Tweedehands keuken' : null,
      l.leverdatum ? `Levering: ${l.leverdatum}` : l.keuken_geleverd === true ? 'Keuken is geleverd' : l.keuken_geleverd === false ? 'Keuken nog niet geleverd' : null,
      l.gewenste_periode ? `Wanneer: ${l.gewenste_periode}` : null,
    ].filter(Boolean).join('\n'),
  ];

  const wat = watRegels(l);
  if (wat.length) blokken.push(`Wat:\n${wat.join('\n')}`);

  if (l.prijs_min) {
    blokken.push(
      `Indicatie gegeven: ${euro(l.prijs_min)}–${euro(l.prijs_max)} ${l.prijs_incl_btw ? 'incl.' : 'excl.'} btw` +
        (l.dagen_min ? `, ${l.dagen_min}–${l.dagen_max} dagen` : ''),
    );
  }

  if (d.samenvatting?.trim()) blokken.push(`Samenvatting:\n${d.samenvatting.trim()}`);

  const waarom = [
    d.aanleiding?.trim() ? `Waarom bij jou: ${d.aanleiding.trim()}` : null,
    d.laatsteKlantbericht?.trim() ? `Laatste bericht klant: "${d.laatsteKlantbericht.trim().slice(0, 400)}"` : null,
  ].filter(Boolean).join('\n');
  if (waarom) blokken.push(waarom);

  if (d.concept?.trim()) blokken.push(`Voorstel:\n${d.concept.trim()}`);
  if (d.extra?.length) blokken.push(d.extra.filter(Boolean).join('\n'));
  blokken.push(bijlagenRegel(d.bestanden, d.nieuweBestanden));

  return blokken.filter((b) => b && b.trim()).join('\n\n');
}

/** "Reden: x. Bekend: … Laatste bericht: …" (vatSamen) eraf: dat staat al in het dossier. */
export function aanleidingUit(samenvatting: string): string {
  return samenvatting.replace(/\s*Reden: [\s\S]*$/, '').trim();
}

/** Bijschrift bij een bestand: welk nummer, wanneer, wat voor bestand. */
export function bijschrift(b: KlantBestand, i: number, n: number, klant: string): string {
  const wanneer = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
    .format(new Date(b.op));
  return `${i + 1}/${n} van ${klant} — ${b.naam} (${wanneer})`;
}
