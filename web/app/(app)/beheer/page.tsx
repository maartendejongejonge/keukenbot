import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { huidigeSessie } from '@/lib/monteur';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { nummer, wanneer } from '@/lib/format';
import { Uitnodigen, MonteurRegel, type BeheerRij } from './onderdelen';

export const metadata: Metadata = { title: 'Beheer' };

export default async function Beheer() {
  const { beheerder } = await huidigeSessie();
  if (!beheerder) notFound();

  const admin = supabaseAdmin();
  const maand = new Date(Date.now() - 30 * 864e5).toISOString();
  const [mRes, lRes] = await Promise.all([
    admin.from('monteurs')
      .select('id, bedrijfsnaam, contactnaam, email, telefoon, abonnement, actief, auth_user_id, uitgenodigd_op, aangemaakt_op, monteur_profielen(profiel_ingevuld, google_gekoppeld_op, whatsapp_nummer)')
      .order('aangemaakt_op'),
    admin.from('leads').select('monteur_id').gte('aangemaakt_op', maand),
  ]);

  const telling = new Map<string, number>();
  for (const l of lRes.data ?? []) telling.set(l.monteur_id, (telling.get(l.monteur_id) ?? 0) + 1);

  const rijen: BeheerRij[] = (mRes.data ?? []).map((m: any) => {
    const p = Array.isArray(m.monteur_profielen) ? m.monteur_profielen[0] : m.monteur_profielen;
    return {
      id: m.id,
      bedrijfsnaam: m.bedrijfsnaam,
      contactnaam: m.contactnaam,
      email: m.email,
      telefoon: nummer(m.telefoon),
      abonnement: m.abonnement,
      actief: m.actief,
      ingelogd: Boolean(m.auth_user_id),
      uitgenodigd: m.uitgenodigd_op ? wanneer(m.uitgenodigd_op) : null,
      profiel: Boolean(p?.profiel_ingevuld),
      google: Boolean(p?.google_gekoppeld_op),
      whatsapp: p?.whatsapp_nummer ? nummer(p.whatsapp_nummer) : '',
      aanvragen: telling.get(m.id) ?? 0,
    };
  });

  return (
    <>
      <div className="kop">
        <h1>Beheer</h1>
        <p className="zacht">Monteurs uitnodigen, hun WhatsApp-nummer koppelen en hun abonnement bijhouden. Alleen jij ziet deze pagina.</p>
      </div>

      <Uitnodigen />

      <section className="stapel" aria-labelledby="monteurs">
        <h2 id="monteurs">Monteurs ({rijen.length})</h2>
        {rijen.map((r) => <MonteurRegel key={r.id} r={r} />)}
      </section>

      <div className="melding actie">
        <strong>Let op bij een tweede WhatsApp-nummer</strong>
        <p>
          De runner op de VPS luistert nu op één nummer (<code>WHATSAPP_NUMMER</code> in de .env). Een monteur met een
          eigen nummer krijgt pas antwoorden als de runner meerdere nummers aankan, of na de overstap naar de officiële
          WhatsApp Business API. Zijn instellingen, agenda en seintjes werken wel al per monteur.
        </p>
      </div>
    </>
  );
}
