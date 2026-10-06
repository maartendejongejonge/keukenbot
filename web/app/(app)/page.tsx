import Link from 'next/link';
import type { Metadata } from 'next';
import { huidigeSessie } from '@/lib/monteur';
import { supabaseServer } from '@/lib/supabase/server';
import { REDEN, SOORT, STATUS, datumTijd, nummer, wanneer } from '@/lib/format';
import type { Afspraak, Lead, Seintje } from '@/lib/types';
import { Kopieer } from '@/components/kopieer';
import { zetSeintje } from './actions';

export const metadata: Metadata = { title: 'Overzicht' };

const DAG = 864e5;

export default async function Overzicht() {
  const { profiel } = await huidigeSessie();
  const supabase = await supabaseServer();
  const nu = new Date();
  const maandGeleden = new Date(+nu - 30 * DAG).toISOString();

  const [seintjesRes, afsprakenRes, lopendRes, recentRes] = await Promise.all([
    supabase.from('review_items').select('*, leads(klant_naam, klant_telefoon, plaats)')
      .eq('status', 'open').order('aangemaakt_op', { ascending: false }).limit(20),
    supabase.from('afspraken').select('*, leads(klant_naam, klant_telefoon, plaats, pc4)')
      .eq('status', 'bevestigd').gte('eind_op', nu.toISOString()).order('start_op').limit(6),
    supabase.from('leads').select('*').in('status', ['nieuw', 'kwalificeren', 'gekwalificeerd'])
      .order('laatste_bericht_op', { ascending: false, nullsFirst: false }).limit(6),
    supabase.from('leads').select('id, status, aangemaakt_op').gte('aangemaakt_op', maandGeleden),
  ]);

  const seintjes = (seintjesRes.data ?? []) as (Seintje & { leads: Partial<Lead> | null })[];
  const afspraken = (afsprakenRes.data ?? []) as (Afspraak & { leads: Partial<Lead> | null })[];
  const lopend = (lopendRes.data ?? []) as Lead[];
  const recent = recentRes.data ?? [];

  const reactie = await gemiddeldeReactie(supabase, recent.map((l) => l.id));

  const stappen = [
    { klaar: profiel.profiel_ingevuld, titel: 'Vul je instellingen in', tekst: 'Werktijden, werkgebied en wat je wel en niet doet.', href: '/instellingen', knop: 'Instellingen' },
    { klaar: Boolean(profiel.google_gekoppeld_op), titel: 'Koppel je Google Agenda', tekst: 'Zodat de bot alleen momenten voorstelt die echt vrij zijn.', href: '/koppelingen', knop: 'Koppelen' },
    { klaar: Boolean(profiel.whatsapp_nummer), titel: 'WhatsApp-nummer', tekst: 'Dit koppelen wij samen met jou bij de inrichting.', href: '/koppelingen', knop: null },
  ];
  const onboarding = stappen.some((s) => !s.klaar);

  return (
    <>
      <div className="kop">
        <h1>Goedendag{profiel.aanspreeknaam ? `, ${profiel.aanspreeknaam}` : ''}</h1>
        <p className="zacht">
          {seintjes.length
            ? `${seintjes.length} ${seintjes.length === 1 ? 'seintje wacht' : 'seintjes wachten'} op jou.`
            : 'Er wacht niets op jou. De bot regelt de rest.'}
        </p>
      </div>

      {onboarding && (
        <section className="vlak" aria-labelledby="start">
          <h2 id="start">Aan de slag</h2>
          <ol className="stappen">
            {stappen.map((s) => (
              <li key={s.titel} className={s.klaar ? 'klaar' : ''}>
                <div><strong>{s.titel}</strong><span className="zacht">{s.tekst}</span></div>
                {!s.klaar && s.knop && <Link className="knop klein" href={s.href}>{s.knop}</Link>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {seintjes.length > 0 && (
        <section className="stapel" aria-labelledby="seintjes">
          <h2 id="seintjes">Wacht op jou</h2>
          {seintjes.map((s) => (
            <article key={s.id} className="melding actie">
              <div className="rij tussen">
                <strong>{REDEN[s.reden] ?? s.reden}</strong>
                <small>{wanneer(s.aangemaakt_op)}</small>
              </div>
              <p>
                {s.leads?.klant_naam ?? nummer(s.leads?.klant_telefoon)}
                {s.leads?.plaats ? ` · ${s.leads.plaats}` : ''}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{s.samenvatting}</p>
              {s.voorgesteld_antwoord && (
                <div className="vlak" style={{ padding: 12 }}>
                  <small>Voorstel voor je antwoord</small>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{s.voorgesteld_antwoord}</p>
                  <div><Kopieer tekst={s.voorgesteld_antwoord} /></div>
                </div>
              )}
              <form action={zetSeintje} className="rij">
                <input type="hidden" name="id" value={s.id} />
                <Link className="knop tweede klein" href={`/gesprekken/${s.lead_id}`}>Gesprek bekijken</Link>
                <button className="klein" name="status" value="afgehandeld">Afgehandeld</button>
                <button className="tweede klein" name="status" value="genegeerd">Negeren</button>
              </form>
            </article>
          ))}
        </section>
      )}

      <section className="vlak" aria-labelledby="maand">
        <h2 id="maand">Laatste 30 dagen</h2>
        <div className="cijfers">
          <div className="cijfer"><b>{recent.length}</b><span>aanvragen</span></div>
          <div className="cijfer"><b>{recent.filter((l) => l.status === 'ingepland').length}</b><span>ingepland door de bot</span></div>
          <div className="cijfer"><b>{recent.filter((l) => l.status === 'afgewezen').length}</b><span>netjes afgewezen</span></div>
          <div className="cijfer"><b>{reactie ?? '–'}</b><span>gemiddelde eerste reactie</span></div>
        </div>
      </section>

      <div className="raster">
        <section className="vlak" aria-labelledby="komend">
          <div className="rij tussen"><h2 id="komend">Komende afspraken</h2></div>
          {afspraken.length ? (
            <ul className="lijst">
              {afspraken.map((a) => (
                <li key={a.id}>
                  <Link className="regel" href={`/gesprekken/${a.lead_id}`}>
                    <strong>{SOORT[a.soort]} · {datumTijd(a.start_op)}</strong>
                    <span className="zacht">
                      {a.leads?.klant_naam ?? nummer(a.leads?.klant_telefoon)}
                      {a.leads?.plaats ? ` · ${a.leads.plaats}` : a.leads?.pc4 ? ` · ${a.leads.pc4}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="zacht">Nog niets ingepland. Zodra een klant een moment kiest, staat het hier en in je agenda.</p>
          )}
        </section>

        <section className="vlak" aria-labelledby="lopend">
          <div className="rij tussen">
            <h2 id="lopend">Bot is bezig met</h2>
            <Link href="/gesprekken" className="zacht">Alles</Link>
          </div>
          {lopend.length ? (
            <ul className="lijst">
              {lopend.map((l) => (
                <li key={l.id}>
                  <Link className="regel" href={`/gesprekken/${l.id}`}>
                    <span className="rij tussen">
                      <strong>{l.klant_naam ?? nummer(l.klant_telefoon)}</strong>
                      <span className={`pil ${STATUS[l.status].toon}`}>{STATUS[l.status].tekst}</span>
                    </span>
                    <span className="zacht">
                      {[l.type_klus, l.plaats ?? l.pc4, wanneer(l.laatste_bericht_op)].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="zacht">Geen lopende gesprekken.</p>
          )}
        </section>
      </div>
    </>
  );
}

/** Tijd tussen het eerste klantbericht en het eerste botbericht, gemiddeld. */
async function gemiddeldeReactie(supabase: Awaited<ReturnType<typeof supabaseServer>>, leadIds: string[]) {
  if (!leadIds.length) return null;
  const { data } = await supabase
    .from('berichten')
    .select('lead_id, afzender, verzonden_op')
    .in('lead_id', leadIds.slice(0, 200))
    .order('verzonden_op');
  const eerste = new Map<string, { klant?: number; bot?: number }>();
  for (const b of data ?? []) {
    const e = eerste.get(b.lead_id) ?? {};
    const t = +new Date(b.verzonden_op);
    if (b.afzender === 'klant' && e.klant === undefined) e.klant = t;
    if (b.afzender === 'bot' && e.bot === undefined && e.klant !== undefined) e.bot = t;
    eerste.set(b.lead_id, e);
  }
  const verschillen = [...eerste.values()].filter((e) => e.klant !== undefined && e.bot !== undefined).map((e) => e.bot! - e.klant!);
  if (!verschillen.length) return null;
  const sec = verschillen.reduce((a, b) => a + b, 0) / verschillen.length / 1000;
  return sec < 90 ? `${Math.round(sec)} sec` : `${Math.round(sec / 60)} min`;
}
