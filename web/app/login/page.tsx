import type { Metadata } from 'next';
import { LoginFormulier } from './formulier';

export const metadata: Metadata = { title: 'Inloggen' };

const FOUTEN: Record<string, string> = {
  'geen-account': 'Dit e-mailadres hoort niet bij een monteur. Vraag een uitnodiging aan.',
  'geen-profiel': 'Je account is nog niet ingericht. Neem contact op met de beheerder.',
  'link-verlopen': 'Deze inloglink is verlopen of al gebruikt. Vraag hieronder een nieuwe aan.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ fout?: string }> }) {
  const { fout } = await searchParams;
  return (
    <div className="login">
      <div className="vlak">
        <div className="kop">
          <span className="merk"><i aria-hidden="true" />Keukenbot</span>
          <p className="zacht">Je aanvragen beantwoord en ingepland terwijl jij onder een aanrecht ligt.</p>
        </div>
        {fout && FOUTEN[fout] && <div className="melding fout" role="alert">{FOUTEN[fout]}</div>}
        <LoginFormulier />
      </div>
    </div>
  );
}
