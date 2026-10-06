import Link from 'next/link';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase/server';
import { STATUS, euro, nummer, wanneer } from '@/lib/format';
import type { Lead, LeadStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Gesprekken' };

const FILTERS: { sleutel: string; tekst: string; statussen: LeadStatus[] | null }[] = [
  { sleutel: 'alle', tekst: 'Alle', statussen: null },
  { sleutel: 'bezig', tekst: 'Bot is bezig', statussen: ['nieuw', 'kwalificeren', 'gekwalificeerd'] },
  { sleutel: 'jou', tekst: 'Bij jou', statussen: ['overgedragen'] },
  { sleutel: 'ingepland', tekst: 'Ingepland', statussen: ['ingepland'] },
  { sleutel: 'afgewezen', tekst: 'Afgewezen', statussen: ['afgewezen', 'verlopen'] },
];

export default async function Gesprekken({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = 'alle' } = await searchParams;
  const gekozen = FILTERS.find((f) => f.sleutel === filter) ?? FILTERS[0];

  const supabase = await supabaseServer();
  let q = supabase.from('leads').select('*').order('laatste_bericht_op', { ascending: false, nullsFirst: false }).limit(100);
  if (gekozen.statussen) q = q.in('status', gekozen.statussen);
  const { data } = await q;
  const leads = (data ?? []) as Lead[];

  return (
    <>
      <div className="kop">
        <h1>Gesprekken</h1>
        <p className="zacht">Alles wat de bot met klanten heeft besproken. Je antwoordt zelf vanaf het botnummer in WhatsApp.</p>
      </div>

      <nav className="dagen" aria-label="Filter">
        {FILTERS.map((f) => (
          <Link
            key={f.sleutel}
            href={f.sleutel === 'alle' ? '/gesprekken' : `/gesprekken?filter=${f.sleutel}`}
            className={f.sleutel === gekozen.sleutel ? 'knop klein' : 'knop tweede klein'}
            aria-current={f.sleutel === gekozen.sleutel ? 'page' : undefined}
          >
            {f.tekst}
          </Link>
        ))}
      </nav>

      <section className="vlak">
        {leads.length ? (
          <ul className="lijst">
            {leads.map((l) => (
              <li key={l.id}>
                <Link className="regel" href={`/gesprekken/${l.id}`}>
                  <span className="rij tussen">
                    <strong>{l.klant_naam ?? nummer(l.klant_telefoon)}</strong>
                    <span className={`pil ${STATUS[l.status].toon}`}>{STATUS[l.status].tekst}</span>
                  </span>
                  <span className="zacht">
                    {[
                      l.type_klus,
                      l.leverancier,
                      l.plaats ?? l.pc4,
                      l.prijs_min ? `${euro(l.prijs_min)}–${euro(l.prijs_max)}` : null,
                      wanneer(l.laatste_bericht_op ?? l.aangemaakt_op),
                    ].filter(Boolean).join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="zacht">Hier staat nog niets. Zodra een klant je botnummer een bericht stuurt, verschijnt het gesprek hier.</p>
        )}
      </section>
    </>
  );
}
