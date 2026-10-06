'use client';

import { useActionState } from 'react';
import { Kopieer } from '@/components/kopieer';
import { nieuweLink, nodigUit, zetAbonnement, zetActief, zetWhatsApp, type BeheerStaat } from './actions';

export interface BeheerRij {
  id: string;
  bedrijfsnaam: string;
  contactnaam: string;
  email: string;
  telefoon: string;
  abonnement: string;
  actief: boolean;
  ingelogd: boolean;
  uitgenodigd: string | null;
  profiel: boolean;
  google: boolean;
  whatsapp: string;
  aanvragen: number;
}

function Link({ staat }: { staat: BeheerStaat }) {
  if (!staat.link) return null;
  const bericht =
    `Hoi ${staat.naam ?? ''}, hierbij je toegang tot de keukenbot. Tik op de link om in te loggen en je instellingen ` +
    `in te vullen:\n${staat.link}\n\nDe link werkt één keer. Daarna log je in met je e-mailadres.`;
  return (
    <div className="melding goed">
      <p><strong>Inloglink</strong> (werkt één keer en verloopt na de tijd die in Supabase is ingesteld, standaard een uur)</p>
      <p style={{ overflowWrap: 'anywhere' }}><code>{staat.link}</code></p>
      <div className="rij">
        <Kopieer tekst={bericht} label="Kopieer bericht voor WhatsApp" />
        <Kopieer tekst={staat.link} label="Kopieer alleen de link" />
      </div>
    </div>
  );
}

export function Uitnodigen() {
  const [staat, verstuur, bezig] = useActionState<BeheerStaat, FormData>(nodigUit, {});
  return (
    <section className="vlak" aria-labelledby="nieuw">
      <h2 id="nieuw">Monteur uitnodigen</h2>
      <form action={verstuur} className="stapel" style={{ gap: 14 }}>
        <div className="velden">
          <label>Bedrijfsnaam<input id="n_bedrijf" name="bedrijfsnaam" required /></label>
          <label>Naam<input id="n_naam" name="contactnaam" required /></label>
          <label>E-mailadres<input id="n_email" name="email" type="email" required /></label>
          <label>Mobiel nummer<span className="uitleg">Voor seintjes, mag later</span><input id="n_tel" name="telefoon" type="tel" placeholder="06-12345678" /></label>
          <label>Abonnement
            <select id="n_ab" name="abonnement" defaultValue="basis">
              <option value="basis">Basis</option><option value="plus">Plus</option><option value="ploeg">Ploeg</option>
            </select>
          </label>
        </div>
        <div className="rij">
          <button disabled={bezig}>{bezig ? 'Bezig…' : 'Account aanmaken'}</button>
          {staat.bericht && <span role="status" style={{ color: staat.ok ? 'var(--accent)' : 'var(--fout)' }}>{staat.bericht}</span>}
        </div>
      </form>
      <Link staat={staat} />
    </section>
  );
}

export function MonteurRegel({ r }: { r: BeheerRij }) {
  const [linkStaat, maakLink, linkBezig] = useActionState<BeheerStaat, FormData>(nieuweLink, {});
  const [waStaat, zetWa, waBezig] = useActionState<BeheerStaat, FormData>(zetWhatsApp, {});

  const pil = (aan: boolean, ja: string, nee: string) => <span className={`pil ${aan ? 'goed' : 'actie'}`}>{aan ? ja : nee}</span>;

  return (
    <article className="vlak">
      <div className="rij tussen">
        <div className="stapel" style={{ gap: 2 }}>
          <h3>{r.bedrijfsnaam}</h3>
          <span className="zacht">{r.contactnaam} · {r.email}{r.telefoon ? ` · ${r.telefoon}` : ''}</span>
        </div>
        <span className={`pil ${r.actief ? 'goed' : 'stil'}`}>{r.actief ? 'Actief' : 'Gepauzeerd'}</span>
      </div>

      <div className="rij">
        {pil(r.ingelogd, 'Ingelogd', r.uitgenodigd ? `Uitgenodigd ${r.uitgenodigd}` : 'Nooit ingelogd')}
        {pil(r.profiel, 'Instellingen ingevuld', 'Instellingen open')}
        {pil(r.google, 'Agenda gekoppeld', 'Geen agenda')}
        {pil(Boolean(r.whatsapp), `WhatsApp ${r.whatsapp}`, 'Geen WhatsApp')}
        <span className="zacht">{r.aanvragen} aanvragen in 30 dagen</span>
      </div>

      <form action={zetWa} className="rij" style={{ alignItems: 'end' }}>
        <input type="hidden" name="id" value={r.id} />
        <label style={{ flex: '1 1 200px' }}>
          WhatsApp-nummer van de bot
          <input id={`wa_${r.id}`} name="whatsapp" type="tel" defaultValue={r.whatsapp} placeholder="06-12345678" />
        </label>
        <button className="tweede" disabled={waBezig}>Opslaan</button>
        {waStaat.bericht && <span role="status" style={{ color: waStaat.ok ? 'var(--accent)' : 'var(--fout)' }}>{waStaat.bericht}</span>}
      </form>

      <div className="rij">
        <form action={maakLink}>
          <input type="hidden" name="id" value={r.id} />
          <button className="tweede klein" disabled={linkBezig}>Nieuwe inloglink</button>
        </form>
        <form action={zetAbonnement} className="rij">
          <input type="hidden" name="id" value={r.id} />
          <select id={`ab_${r.id}`} name="abonnement" defaultValue={r.abonnement} aria-label="Abonnement" style={{ width: 'auto' }}>
            <option value="basis">Basis</option><option value="plus">Plus</option><option value="ploeg">Ploeg</option>
          </select>
          <button className="tweede klein">Wijzig</button>
        </form>
        <form action={zetActief}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="actief" value={String(!r.actief)} />
          <button className="tweede klein">{r.actief ? 'Pauzeren' : 'Weer aanzetten'}</button>
        </form>
      </div>
      {linkStaat.bericht && !linkStaat.ok && <p style={{ color: 'var(--fout)' }}>{linkStaat.bericht}</p>}
      <Link staat={linkStaat} />
    </article>
  );
}
