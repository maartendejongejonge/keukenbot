import type { Metadata } from 'next';
import { huidigeSessie } from '@/lib/monteur';
import { Instellingen } from './formulier';

export const metadata: Metadata = { title: 'Instellingen' };

export default async function InstellingenPagina() {
  const { monteur, profiel } = await huidigeSessie();
  return (
    <>
      <div className="kop">
        <h1>Instellingen</h1>
        <p className="zacht">
          Hiermee weet de bot wanneer je kunt, waar je komt en wat je wel en niet doet. Wijzigingen gelden vanaf het
          volgende bericht van een klant.
        </p>
      </div>
      <Instellingen monteur={monteur} profiel={profiel} />
    </>
  );
}
