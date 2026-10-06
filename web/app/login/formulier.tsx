'use client';

import { useActionState } from 'react';
import { controleerCode, stuurLink, type LoginStaat } from './actions';

export function LoginFormulier() {
  const [staat, verstuur, bezig] = useActionState<LoginStaat, FormData>(
    async (vorige, form) => (form.get('code') !== null ? controleerCode(vorige, form) : stuurLink(vorige, form)),
    { stap: 'email' },
  );

  if (staat.stap === 'code') {
    return (
      <form action={verstuur} className="stapel">
        <div className="melding goed">
          <p>
            Als <strong>{staat.email}</strong> bij een monteur hoort, staat er nu een mail in je inbox. Tik op de
            link, of typ hieronder de code uit de mail.
          </p>
        </div>
        <input type="hidden" name="email" value={staat.email} />
        <label>
          Code uit de mail
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
        </label>
        {staat.fout && <p role="alert" style={{ color: 'var(--fout)' }}>{staat.fout}</p>}
        <button disabled={bezig}>{bezig ? 'Bezig…' : 'Inloggen'}</button>
        <p className="zacht"><a href="/login">Ander e-mailadres</a></p>
      </form>
    );
  }

  return (
    <form action={verstuur} className="stapel">
      <label>
        E-mailadres
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={staat.email} required autoFocus />
      </label>
      {staat.fout && <p role="alert" style={{ color: 'var(--fout)' }}>{staat.fout}</p>}
      <button disabled={bezig}>{bezig ? 'Bezig…' : 'Stuur inloglink'}</button>
      <p className="zacht">Geen wachtwoord nodig. Je krijgt een link en een code per mail.</p>
    </form>
  );
}
