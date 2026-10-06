'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { huidigeSessie } from '@/lib/monteur';
import { leesEenPc4, leesPc4 } from '@/lib/pc4';
import { normaliseerNummer } from '@/lib/format';
import { UURNORM_VELDEN, type Uurnormen } from '@/lib/uurnormen';

export interface Opslagstaat {
  ok?: boolean;
  fouten?: Record<string, string>;
  bericht?: string;
}

const tekst = (f: FormData, n: string) => String(f.get(n) ?? '').trim();
const vink = (f: FormData, n: string) => f.get(n) === 'on';
const regels = (f: FormData, n: string) =>
  tekst(f, n).split('\n').map((r) => r.trim()).filter(Boolean).slice(0, 20).map((r) => r.slice(0, 300));

function getal(f: FormData, n: string, fouten: Record<string, string>, opts: { min?: number; max?: number; leeg?: boolean } = {}) {
  const ruw = tekst(f, n).replace(',', '.');
  if (!ruw) {
    if (opts.leeg) return null;
    fouten[n] = 'Vul een getal in.';
    return null;
  }
  const v = Number(ruw);
  if (!Number.isFinite(v)) { fouten[n] = 'Dit is geen getal.'; return null; }
  if (opts.min !== undefined && v < opts.min) { fouten[n] = `Minimaal ${opts.min}.`; return null; }
  if (opts.max !== undefined && v > opts.max) { fouten[n] = `Maximaal ${opts.max}.`; return null; }
  return v;
}

const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;
const SOORTEN_WEIGEREN = ['ombouw', 'losse_kast', 'reparatie'];

export async function slaOp(_: Opslagstaat, f: FormData): Promise<Opslagstaat> {
  const { monteur } = await huidigeSessie();
  const fouten: Record<string, string> = {};

  // ------------------------------------------------ jij
  const contactnaam = tekst(f, 'contactnaam');
  if (!contactnaam) fouten.contactnaam = 'Vul je naam in.';
  const aanspreeknaam = tekst(f, 'aanspreeknaam').slice(0, 40) || null;
  const meldRuw = tekst(f, 'telefoon');
  const telefoon = meldRuw ? normaliseerNummer(meldRuw) : null;
  if (meldRuw && !telefoon) fouten.telefoon = 'Gebruik een mobiel nummer, bijvoorbeeld 06-12345678.';

  // ------------------------------------------------ werktijden
  const werkdagen = [1, 2, 3, 4, 5, 6, 7].filter((d) => vink(f, `dag${d}`));
  if (!werkdagen.length) fouten.werkdagen = 'Kies minstens één werkdag.';
  const werkdag_start = tekst(f, 'werkdag_start');
  const werkdag_eind = tekst(f, 'werkdag_eind');
  if (!TIJD.test(werkdag_start)) fouten.werkdag_start = 'Bijvoorbeeld 07:30.';
  if (!TIJD.test(werkdag_eind)) fouten.werkdag_eind = 'Bijvoorbeeld 17:00.';
  if (!fouten.werkdag_start && !fouten.werkdag_eind && werkdag_eind <= werkdag_start) fouten.werkdag_eind = 'Moet na de begintijd liggen.';

  // ------------------------------------------------ werkgebied
  const vertrek = tekst(f, 'vertrek_postcode');
  const vertrek_postcode = vertrek ? leesEenPc4(vertrek) : null;
  if (!vertrek_postcode) fouten.vertrek_postcode = 'De vier cijfers van de postcode waar je vertrekt.';
  const werkgebied = leesPc4(tekst(f, 'werkgebied_pc4'));
  if (werkgebied.fout) fouten.werkgebied_pc4 = werkgebied.fout;
  const max_reistijd_min = getal(f, 'max_reistijd_min', fouten, { min: 10, max: 240 });

  // ------------------------------------------------ planning
  const inmeting_duur_min = getal(f, 'inmeting_duur_min', fouten, { min: 15, max: 480 });
  const montageDagen = getal(f, 'montage_dagen', fouten, { min: 0.5, max: 15 });
  const buffer_dagdelen = getal(f, 'buffer_dagdelen', fouten, { min: 0, max: 10 });

  // ------------------------------------------------ reiskosten
  const km_tarief = getal(f, 'km_tarief', fouten, { min: 0, max: 5 });
  const reisuur_percentage = getal(f, 'reisuur_percentage', fouten, { min: 0, max: 100 });
  const gratis = leesPc4(tekst(f, 'gratis_pc4'));
  if (gratis.fout) fouten.gratis_pc4 = gratis.fout;
  const hotel_richtprijs = getal(f, 'hotel_richtprijs', fouten, { min: 0, max: 1000 });

  // ------------------------------------------------ prijzen
  const prijzen_tonen = vink(f, 'prijzen_tonen');
  const uurtarief = getal(f, 'uurtarief', fouten, { min: 0, max: 500, leeg: !prijzen_tonen });
  let uurnormen: Uurnormen | null = null;
  if (prijzen_tonen) {
    if (!uurtarief) fouten.uurtarief ??= 'Nodig om prijzen te tonen.';
    const u: Record<string, unknown> = {};
    for (const v of UURNORM_VELDEN) {
      const n = getal(f, `un_${v.sleutel}`, fouten, { min: 0, max: v.max ?? 100 });
      if (n === null) continue;
      const [a, b] = v.sleutel.split('.');
      if (b) u[a] = { ...(u[a] as object | undefined), [b]: n };
      else u[a] = n;
    }
    uurnormen = u as unknown as Uurnormen;
  }

  // ------------------------------------------------ klusjes
  let klusjes: object | null = null;
  if (vink(f, 'klusjes_aan')) {
    const kt = getal(f, 'klusjes_uurtarief', fouten, { min: 1, max: 500 });
    const km = getal(f, 'klusjes_minimum_uren', fouten, { min: 0.5, max: 8 });
    const kg = leesPc4(tekst(f, 'klusjes_pc4'));
    if (kg.fout) fouten.klusjes_pc4 = kg.fout;
    klusjes = { uurtarief: kt, minimum_uren: km, incl_btw: true, werkgebied_pc4: kg.lijst };
  }

  // ------------------------------------------------ transport
  let transport: object | null = null;
  if (vink(f, 'transport_aan')) {
    transport = {
      autohuur: getal(f, 'transport_autohuur', fouten, { min: 1, max: 2000 }),
      uurtarief: getal(f, 'transport_uurtarief', fouten, { min: 1, max: 500 }),
    };
  }

  // ------------------------------------------------ de bot
  const toon = tekst(f, 'toon').slice(0, 200) || 'nuchter, beleefd, kort';
  const weigert = [...SOORTEN_WEIGEREN.filter((s) => vink(f, `weiger_${s}`)), ...regels(f, 'weigert')];
  const advies = regels(f, 'advies');

  if (Object.keys(fouten).length) {
    return { fouten, bericht: 'Niet opgeslagen. Kijk de rood gemarkeerde velden na.' };
  }

  const supabase = await supabaseServer();
  const m = await supabase.from('monteurs').update({ contactnaam, telefoon }).eq('id', monteur.id);
  const p = await supabase.from('monteur_profielen').update({
    aanspreeknaam, toon, weigert, advies,
    werkdagen, werkdag_start, werkdag_eind,
    vertrek_postcode, werkgebied_pc4: werkgebied.lijst, max_reistijd_min,
    inmeting_duur_min,
    montage_duur_dagdelen: Math.round(montageDagen! * 2),
    buffer_dagdelen,
    hersteldag_na_meerdaagse: vink(f, 'hersteldag_na_meerdaagse'),
    km_tarief, reisuur_percentage, gratis_pc4: gratis.lijst, hotel_richtprijs,
    prijzen_tonen, uurtarief, uurnormen: prijzen_tonen ? uurnormen : undefined,
    klusjes, transport,
    profiel_ingevuld: true,
  }).eq('monteur_id', monteur.id);

  const fout = m.error ?? p.error;
  if (fout) {
    console.error('opslaan profiel:', fout.message);
    return { bericht: 'Opslaan mislukt. Probeer het opnieuw; blijft het misgaan, neem dan contact op.' };
  }

  revalidatePath('/', 'layout');
  return { ok: true, bericht: 'Opgeslagen. De bot gebruikt dit vanaf het volgende bericht.' };
}
