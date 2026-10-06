import type { Metadata } from 'next';
import { huidigeSessie } from '@/lib/monteur';
import { nummer, wanneer } from '@/lib/format';
import { ontkoppelGoogle } from './actions';

export const metadata: Metadata = { title: 'Koppelingen' };

const GOOGLE_UITSLAG: Record<string, { soort: 'goed' | 'fout'; tekst: string }> = {
  ok: { soort: 'goed', tekst: 'Je Google Agenda is gekoppeld. De bot kijkt vanaf nu in je agenda voordat hij een moment voorstelt.' },
  geweigerd: { soort: 'fout', tekst: 'Je hebt de toegang bij Google geweigerd. Zonder agenda kan de bot geen momenten voorstellen.' },
  'geen-token': { soort: 'fout', tekst: 'Google gaf geen blijvende toegang. Probeer het nog een keer.' },
  mislukt: { soort: 'fout', tekst: 'Koppelen is niet gelukt. Probeer het nog een keer; blijft het misgaan, neem dan contact op.' },
};

export default async function Koppelingen({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { profiel, monteur } = await huidigeSessie();
  const { google } = await searchParams;
  const uitslag = google ? GOOGLE_UITSLAG[google] : undefined;

  return (
    <>
      <div className="kop">
        <h1>Koppelingen</h1>
        <p className="zacht">Waar de bot zijn berichten ontvangt en waar hij je afspraken neerzet.</p>
      </div>

      {uitslag && <div className={`melding ${uitslag.soort}`} role="status">{uitslag.tekst}</div>}

      <section className="vlak" aria-labelledby="g">
        <div className="rij tussen">
          <h2 id="g">Google Agenda</h2>
          <span className={`pil ${profiel.google_gekoppeld_op ? 'goed' : 'actie'}`}>
            {profiel.google_gekoppeld_op ? 'Gekoppeld' : 'Niet gekoppeld'}
          </span>
        </div>
        {profiel.google_gekoppeld_op ? (
          <>
            <p>
              {profiel.google_email ? <>Agenda van <strong>{profiel.google_email}</strong>, </> : null}
              gekoppeld {wanneer(profiel.google_gekoppeld_op)}.
            </p>
            <p className="zacht">
              De bot ziet alleen wanneer je bezet bent, niet wat er in je afspraken staat. Bevestigde afspraken zet hij er
              in donkerblauw bij.
            </p>
            <div className="rij">
              <a className="knop tweede" href="/api/google/start">Opnieuw koppelen</a>
              <form action={ontkoppelGoogle}><button className="tweede">Ontkoppelen</button></form>
            </div>
          </>
        ) : (
          <>
            <p>
              Zonder agenda kan de bot geen momenten voorstellen. Hij leest alleen wanneer je bezet bent en zet
              bevestigde afspraken in je agenda.
            </p>
            <div><a className="knop" href="/api/google/start">Koppel Google Agenda</a></div>
          </>
        )}
      </section>

      <section className="vlak" aria-labelledby="w">
        <div className="rij tussen">
          <h2 id="w">WhatsApp</h2>
          <span className={`pil ${profiel.whatsapp_nummer ? 'goed' : 'bezig'}`}>
            {profiel.whatsapp_nummer ? 'Gekoppeld' : 'Wordt ingericht'}
          </span>
        </div>
        {profiel.whatsapp_nummer ? (
          <>
            <p>De bot beantwoordt berichten op <strong>{nummer(profiel.whatsapp_nummer)}</strong>.</p>
            <p className="zacht">
              Zet dit nummer op je website, Marktplaats en bij Zoofy. Een gesprek dat de bot aan jou overdraagt, beantwoord
              je zelf vanaf dit nummer.
            </p>
          </>
        ) : (
          <p>
            Het WhatsApp-nummer koppelen we samen met jou bij de inrichting. Je hoeft hier niets voor te doen; we nemen
            contact op.
          </p>
        )}
      </section>

      <section className="vlak" aria-labelledby="s">
        <div className="rij tussen">
          <h2 id="s">Seintjes</h2>
          <span className={`pil ${monteur.telefoon ? 'goed' : 'actie'}`}>{monteur.telefoon ? 'Aan' : 'Geen nummer'}</span>
        </div>
        <p>
          {monteur.telefoon
            ? <>Seintjes en ingeplande afspraken komen via WhatsApp binnen op <strong>{nummer(monteur.telefoon)}</strong>.</>
            : 'Vul bij Instellingen je eigen mobiele nummer in, dan krijg je seintjes via WhatsApp.'}
        </p>
        <p className="zacht">Ze staan ook altijd op het overzicht hier.</p>
      </section>
    </>
  );
}
