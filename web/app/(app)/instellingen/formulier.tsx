'use client';

import { startTransition, useActionState, useState } from 'react';
import type { Monteur, Profiel } from '@/lib/types';
import { DAGEN, nummer } from '@/lib/format';
import { toonPc4 } from '@/lib/pc4';
import { UURNORM_VELDEN, uurnormWaarde } from '@/lib/uurnormen';
import { slaOp, type Opslagstaat } from './actions';

const SOORTEN: [string, string][] = [
  ['ombouw', 'Ombouw of verbouwing van een bestaande keuken'],
  ['losse_kast', 'Losse kast plaatsen'],
  ['reparatie', 'Reparaties (scharnier, lade, spoelbak)'],
];

export function Instellingen({ monteur, profiel: p }: { monteur: Monteur; profiel: Profiel }) {
  const [staat, verstuur, bezig] = useActionState<Opslagstaat, FormData>(slaOp, {});
  const [prijzen, setPrijzen] = useState(p.prijzen_tonen);
  const [klusjes, setKlusjes] = useState(Boolean(p.klusjes));
  const [transport, setTransport] = useState(Boolean(p.transport));
  const f = staat.fouten ?? {};
  const fout = (...namen: string[]) => namen.some((n) => Object.keys(f).some((k) => k === n || k.startsWith(n)));

  const veld = (naam: string, label: string, el: React.ReactNode, uitleg?: string) => (
    <label htmlFor={naam}>
      {label}
      {uitleg && <span className="uitleg">{uitleg}</span>}
      {el}
      {f[naam] && <span role="alert" style={{ color: 'var(--fout)', fontSize: 13 }}>{f[naam]}</span>}
    </label>
  );
  const num = (naam: string, waarde: number | string | null | undefined, stap = '1') => (
    <input id={naam} name={naam} inputMode="decimal" type="number" step={stap} defaultValue={waarde ?? ''}
      aria-invalid={Boolean(f[naam])} />
  );

  const weigertVrij = p.weigert.filter((w) => !SOORTEN.some(([s]) => s === w));
  const groepen = [...new Set(UURNORM_VELDEN.map((v) => v.groep))];

  return (
    <form
      className="stapel"
      style={{ gap: 12 }}
      // Niet via action={…}: React zet het formulier dan na elke poging terug,
      // en bij een fout ben je je wijzigingen kwijt.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => verstuur(data));
      }}
    >
      <details className="sectie" open={!p.profiel_ingevuld || fout('contactnaam', 'aanspreeknaam', 'telefoon')}>
        <summary><span><h2>Jij</h2><small>Naam en het nummer waar seintjes heen gaan</small></span></summary>
        <div className="inhoud">
          <div className="velden">
            {veld('contactnaam', 'Je naam', <input id="contactnaam" name="contactnaam" defaultValue={monteur.contactnaam} autoComplete="name" />)}
            {veld('aanspreeknaam', 'Naam voor klanten', <input id="aanspreeknaam" name="aanspreeknaam" defaultValue={p.aanspreeknaam ?? ''} placeholder="Bijvoorbeeld Jos" />, 'De bot zegt: "Jos neemt contact met u op."')}
            {veld('telefoon', 'Je eigen mobiele nummer', <input id="telefoon" name="telefoon" type="tel" defaultValue={nummer(monteur.telefoon)} placeholder="06-12345678" autoComplete="tel" />, 'Hier stuurt de bot seintjes en ingeplande afspraken naartoe via WhatsApp.')}
          </div>
          <label><input type="checkbox" name="telefoon_voor_klanten" defaultChecked={p.telefoon_voor_klanten ?? false} /> Klanten mogen dit nummer krijgen als ze liever met jou zelf praten</label>
        </div>
      </details>

      <details className="sectie" open={!p.profiel_ingevuld || fout('werkdag')}>
        <summary><span><h2>Werktijden</h2><small>Alleen binnen deze tijden stelt de bot momenten voor</small></span></summary>
        <div className="inhoud">
          <fieldset>
            <legend>Werkdagen</legend>
            <div className="dagen">
              {DAGEN.map(([d, naam]) => (
                <label key={d}><input type="checkbox" name={`dag${d}`} defaultChecked={p.werkdagen.includes(d)} />{naam}</label>
              ))}
            </div>
            {f.werkdagen && <span role="alert" style={{ color: 'var(--fout)', fontSize: 13 }}>{f.werkdagen}</span>}
          </fieldset>
          <div className="velden smal">
            {veld('werkdag_start', 'Begin', <input id="werkdag_start" name="werkdag_start" type="time" defaultValue={p.werkdag_start.slice(0, 5)} />)}
            {veld('werkdag_eind', 'Eind', <input id="werkdag_eind" name="werkdag_eind" type="time" defaultValue={p.werkdag_eind.slice(0, 5)} />)}
          </div>
        </div>
      </details>

      <details className="sectie" open={!p.profiel_ingevuld || fout('vertrek_postcode', 'werkgebied_pc4', 'max_reistijd_min')}>
        <summary><span><h2>Werkgebied</h2><small>Waar je vandaan rijdt en hoe ver je wilt</small></span></summary>
        <div className="inhoud">
          <div className="velden">
            {veld('vertrek_postcode', 'Je vertrekpostcode', <input id="vertrek_postcode" name="vertrek_postcode" defaultValue={p.vertrek_postcode ?? ''} placeholder="3028" maxLength={7} />, 'Alleen de vier cijfers.')}
            {veld('max_reistijd_min', 'Maximaal rijden tussen twee klussen', num('max_reistijd_min', p.max_reistijd_min), 'In minuten.')}
          </div>
          {veld('werkgebied_pc4', 'Alleen in deze postcodes', <input id="werkgebied_pc4" name="werkgebied_pc4" defaultValue={toonPc4(p.werkgebied_pc4)} placeholder="Leeg = overal" />,
            'Leeg laten als je overal komt. Reeksen mogen: 3011-3089, 3100-3199. Buiten dit gebied wijst de bot netjes af.')}
        </div>
      </details>

      <details className="sectie" open={fout('inmeting_duur_min', 'montage_dagen', 'buffer_dagdelen')}>
        <summary><span><h2>Planning</h2><small>Hoe lang een inmeting en een montage duren</small></span></summary>
        <div className="inhoud">
          <div className="velden smal">
            {veld('inmeting_duur_min', 'Inmeting', num('inmeting_duur_min', p.inmeting_duur_min), 'Minuten.')}
            {veld('montage_dagen', 'Montage', num('montage_dagen', p.montage_duur_dagdelen / 2, '0.5'), 'Werkdagen, als er geen prijsberekening is.')}
            {veld('buffer_dagdelen', 'Vrij houden per week', num('buffer_dagdelen', p.buffer_dagdelen), 'Dagdelen voor uitloop en eigen werk.')}
          </div>
          <label className="vink"><input type="checkbox" name="hersteldag_na_meerdaagse" defaultChecked={p.hersteldag_na_meerdaagse} />
            <span>Dag na een meerdaagse montage vrijhouden<br /><span className="uitleg">Voor uitloop en opruimen.</span></span></label>
        </div>
      </details>

      <details className="sectie" open={fout('km_tarief', 'reisuur_percentage', 'hotel_richtprijs', 'gratis_pc4')}>
        <summary><span><h2>Reiskosten</h2><small>Ziet alleen jij, in de melding bij een ingeplande klus</small></span></summary>
        <div className="inhoud">
          <div className="velden smal">
            {veld('km_tarief', 'Per kilometer', num('km_tarief', p.km_tarief, '0.01'), '€')}
            {veld('reisuur_percentage', 'Reisuren rekenen', num('reisuur_percentage', p.reisuur_percentage), '% van je uurtarief')}
            {veld('hotel_richtprijs', 'Hotel per nacht', num('hotel_richtprijs', p.hotel_richtprijs), '€, om te zien wanneer overnachten goedkoper is')}
          </div>
          {veld('gratis_pc4', 'Geen reiskosten in', <input id="gratis_pc4" name="gratis_pc4" defaultValue={toonPc4(p.gratis_pc4)} placeholder="3011-3089" />)}
        </div>
      </details>

      <details className="sectie" open={fout('uurtarief', 'un_')}>
        <summary><span><h2>Prijsindicatie</h2><small>{prijzen ? 'Aan: de bot noemt een bandbreedte' : 'Uit: de bot noemt geen bedragen'}</small></span></summary>
        <div className="inhoud">
          <label className="vink"><input type="checkbox" name="prijzen_tonen" checked={prijzen} onChange={(e) => setPrijzen(e.target.checked)} />
            <span>De bot geeft klanten een prijsindicatie voor een keukenmontage
              <br /><span className="uitleg">De klant ziet alleen een bandbreedte en het aantal werkdagen, nooit je uurtarief of uren. Werk zonder vaste prijs (leidingwerk, slopen) zet de bot apart, dat offreer je zelf.</span></span>
          </label>
          <div className="velden smal">
            {veld('uurtarief', 'Je uurtarief', num('uurtarief', p.uurtarief, '0.5'), '€ excl. btw. Ook gebruikt voor reisuren.')}
          </div>
          {prijzen && (
            <>
              <p className="zacht">Uren per onderdeel. Ingevuld met de normen van Rotterdam Keukenmontage als je nog niets had; pas ze aan naar je eigen tempo.</p>
              {groepen.map((g) => (
                <fieldset key={g}>
                  <legend><strong>{g}</strong></legend>
                  <div className="velden smal">
                    {UURNORM_VELDEN.filter((v) => v.groep === g).map((v) => {
                      const n = `un_${v.sleutel}`;
                      return veld(n, v.tekst, num(n, uurnormWaarde(p.uurnormen, v.sleutel), '0.05'), v.eenheid);
                    })}
                  </div>
                </fieldset>
              ))}
            </>
          )}
        </div>
      </details>

      <details className="sectie" open={fout('klusjes_')}>
        <summary><span><h2>Klusjes buiten de keuken</h2><small>{klusjes ? 'Aan, tegen een vast bezoektarief' : 'Uit: de bot wijst ze netjes af'}</small></span></summary>
        <div className="inhoud">
          <label className="vink"><input type="checkbox" name="klusjes_aan" checked={klusjes} onChange={(e) => setKlusjes(e.target.checked)} />
            <span>Ik neem klusjes aan (lamp ophangen, gordijnrails, schilderijen)
              <br /><span className="uitleg">De klant hoort alleen wat een bezoek kost (uurtarief × minimum uren), niet het uurtarief.</span></span>
          </label>
          {klusjes && (
            <>
              <div className="velden smal">
                {veld('klusjes_uurtarief', 'Uurtarief klusjes', num('klusjes_uurtarief', p.klusjes?.uurtarief ?? 95), '€ incl. btw')}
                {veld('klusjes_minimum_uren', 'Minimaal', num('klusjes_minimum_uren', p.klusjes?.minimum_uren ?? 2, '0.5'), 'uur per bezoek')}
              </div>
              {veld('klusjes_pc4', 'Alleen in deze postcodes', <input id="klusjes_pc4" name="klusjes_pc4" defaultValue={toonPc4(p.klusjes?.werkgebied_pc4)} placeholder="Leeg = je hele werkgebied" />)}
            </>
          )}
        </div>
      </details>

      <details className="sectie" open={fout('transport_')}>
        <summary><span><h2>Transport</h2><small>{transport ? 'Aan: de bot mag de vervoerskosten noemen' : 'Uit'}</small></span></summary>
        <div className="inhoud">
          <label className="vink"><input type="checkbox" name="transport_aan" checked={transport} onChange={(e) => setTransport(e.target.checked)} />
            <span>Ik kan een keuken ophalen en vervoeren
              <br /><span className="uitleg">Handig bij tweedehands keukens. Verticaal transport (verhuislift) prijst de bot nooit.</span></span>
          </label>
          {transport && (
            <div className="velden smal">
              {veld('transport_autohuur', 'Autohuur', num('transport_autohuur', p.transport?.autohuur ?? 200), '€ per rit')}
              {veld('transport_uurtarief', 'Per uur', num('transport_uurtarief', p.transport?.uurtarief ?? 85), '€, jij plus vervoer')}
            </div>
          )}
        </div>
      </details>

      <details className="sectie" open={fout('toon', 'weigert', 'advies')}>
        <summary><span><h2>De bot</h2><small>Toon, wat je niet doet en wat hij mag aanraden</small></span></summary>
        <div className="inhoud">
          {veld('toon', 'Toon', <input id="toon" name="toon" defaultValue={p.toon} maxLength={200} />, 'Een paar woorden, bijvoorbeeld: nuchter, beleefd, kort.')}
          <fieldset>
            <legend><strong>Dit doe ik niet</strong> <span className="zacht">(de bot wijst het meteen af)</span></legend>
            {SOORTEN.map(([s, t]) => (
              <label key={s} className="vink"><input type="checkbox" name={`weiger_${s}`} defaultChecked={p.weigert.includes(s)} /><span>{t}</span></label>
            ))}
          </fieldset>
          {veld('weigert', 'Andere dingen die je niet doet', <textarea id="weigert" name="weigert" defaultValue={weigertVrij.join('\n')} placeholder={'wrappen\ntegelwerk'} />, 'Eén per regel.')}
          {veld('advies', 'Wat de bot mag aanraden', <textarea id="advies" name="advies" defaultValue={p.advies.join('\n')} placeholder="Bij een stenen werkblad regelen wij extra mankracht." />, 'Eén per regel. Bijvoorbeeld een elektricien uit je team.')}
        </div>
      </details>

      <div className="opslaan">
        <button disabled={bezig}>{bezig ? 'Opslaan…' : 'Opslaan'}</button>
        {staat.bericht && (
          <span role="status" style={{ color: staat.ok ? 'var(--accent)' : 'var(--fout)' }}>{staat.bericht}</span>
        )}
      </div>
    </form>
  );
}
