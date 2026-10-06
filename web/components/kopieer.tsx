'use client';

import { useState } from 'react';

/** Kopieert een voorgesteld antwoord, zodat je het in WhatsApp kunt plakken. */
export function Kopieer({ tekst, label = 'Kopieer' }: { tekst: string; label?: string }) {
  const [klaar, setKlaar] = useState(false);
  return (
    <button
      type="button"
      className="tweede klein"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(tekst);
          setKlaar(true);
          setTimeout(() => setKlaar(false), 2000);
        } catch {
          // Klembord geweigerd: niets aan te doen, de tekst staat er nog.
        }
      }}
    >
      {klaar ? 'Gekopieerd' : label}
    </button>
  );
}
