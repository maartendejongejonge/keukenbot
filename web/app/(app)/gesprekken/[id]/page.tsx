import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase/server';
import { REDEN, SOORT, STATUS, datumTijd, euro, nummer, wanneer } from '@/lib/format';
import type { Afspraak, Bericht, Lead, Seintje } from '@/lib/types';
import { Kopieer } from '@/components/kopieer';
import { zetSeintje } from '../../actions';

export const metadata: Metadata = { title: 'Gesprek' };

export default async function Gesprek({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await supabaseServer();
  const [leadRes, berichtenRes, afsprakenRes, seintjesRes] = await Promise.all([
    supabase.from('leads').select('*').eq('id', id).maybeSingle(),
    supabase.from('berichten').select('*').eq('lead_id', id).order('verzonden_op'),
    supabase.from('afspraken').select('*').eq('lead_id', id).neq('status', 'geannuleerd').order('start_op'),
    supabase.from('review_items').select('*').eq('lead_id', id).order('aangemaakt_op', { ascending: false }),
  ]);

  const lead = leadRes.data as Lead | null;
  if (!lead) notFound();
  const berichten = (berichtenRes.data ?? []) as Bericht[];
  const afspraken = (afsprakenRes.data ?? []) as Afspraak[];
  const seintjes = (seintjesRes.data ?? []) as Seintje[];

  const gegevens: [string, React.ReactNode][] = [
    ['Telefoon', <span key="t" className="rij">{nummer(lead.klant_telefoon)} {lead.klant_telefoon && <Kopieer tekst={nummer(lead.klant_telefoon)} />}</span>],
    ['Klus', lead.type_klus],
    ['Keuken', [lead.leverancier, lead.omvang, lead.tweedehands ? 'tweedehands' : null].filter(Boolean).join(', ')],
    ['Plaats', [lead.pc4, lead.plaats].filter(Boolean).join(' ')],
    ['Verdieping', lead.verdieping != null ? `${lead.verdieping}e${lead.lift === false ? ', geen lift' : lead.lift ? ', met lift' : ''}` : null],
    ['Geleverd', lead.keuken_geleverd == null ? null : lead.keuken_geleverd ? 'ja' : lead.leverdatum ? `nee, verwacht ${lead.leverdatum}` : 'nee'],
    ['Werkblad', lead.werkblad_door],
    ['Installatie', lead.installatiewerk?.join(', ')],
    ['Klusjes', lead.klusjes],
    ['Wanneer', lead.gewenste_periode],
    ['Indicatie', lead.prijs_min ? `${euro(lead.prijs_min)}–${euro(lead.prijs_max)} ${lead.prijs_incl_btw ? 'incl.' : 'excl.'} btw` : null],
    ['Doorlooptijd', lead.dagen_min ? `${lead.dagen_min}–${lead.dagen_max} werkdagen` : null],
    ['Afstand', lead.afstand_km ? `${lead.afstand_km} km${lead.reiskosten ? `, reiskosten ${euro(lead.reiskosten)}` : ''}` : null],
    ['Afgewezen', lead.afwijsreden ? REDEN[lead.afwijsreden] ?? lead.afwijsreden : null],
  ];

  return (
    <>
      <div className="kop">
        <p><Link href="/gesprekken" className="zacht">← Gesprekken</Link></p>
        <div className="rij tussen">
          <h1>{lead.klant_naam ?? nummer(lead.klant_telefoon)}</h1>
          <span className={`pil ${STATUS[lead.status].toon}`}>{STATUS[lead.status].tekst}</span>
        </div>
        <p className="zacht">Begonnen {wanneer(lead.aangemaakt_op)}</p>
      </div>

      {seintjes.filter((s) => s.status === 'open').map((s) => (
        <div key={s.id} className="melding actie">
          <strong>{REDEN[s.reden] ?? s.reden}</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{s.samenvatting}</p>
          {s.voorgesteld_antwoord && <div className="rij"><Kopieer tekst={s.voorgesteld_antwoord} label="Kopieer voorgesteld antwoord" /></div>}
          <form action={zetSeintje} className="rij">
            <input type="hidden" name="id" value={s.id} />
            <button className="klein" name="status" value="afgehandeld">Afgehandeld</button>
            <button className="tweede klein" name="status" value="genegeerd">Negeren</button>
          </form>
        </div>
      ))}

      <div className="raster" style={{ alignItems: 'start' }}>
        <section className="vlak" aria-labelledby="gesprek" style={{ gridColumn: '1 / -1' }}>
          <h2 id="gesprek">WhatsApp</h2>
          {berichten.length ? (
            <div className="gesprek">
              {berichten.map((b) => (
                <div key={b.id} className={`bel ${b.afzender}`}>
                  <small className="zacht">{b.afzender === 'klant' ? 'Klant' : b.afzender === 'bot' ? 'Bot' : 'Jij'} · {datumTijd(b.verzonden_op)}</small>
                  {b.tekst}
                </div>
              ))}
            </div>
          ) : (
            <p className="zacht">Nog geen berichten.</p>
          )}
        </section>

        <section className="vlak" aria-labelledby="gegevens">
          <h2 id="gegevens">Wat de bot weet</h2>
          <dl className="gegevens">
            {gegevens.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>

        {afspraken.length > 0 && (
          <section className="vlak" aria-labelledby="afspraken">
            <h2 id="afspraken">Afspraken</h2>
            <ul className="lijst">
              {afspraken.map((a) => (
                <li key={a.id}>
                  <strong>{SOORT[a.soort]} · {datumTijd(a.start_op)}</strong>
                  <span className={`pil ${a.status === 'bevestigd' ? 'goed' : 'bezig'}`}>
                    {a.status === 'bevestigd' ? 'In je agenda' : 'Voorgesteld aan klant'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
