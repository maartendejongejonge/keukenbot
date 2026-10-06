import Link from 'next/link';
import { Menu } from '@/components/menu';
import { huidigeSessie } from '@/lib/monteur';
import { supabaseServer } from '@/lib/supabase/server';
import { uitloggen } from '../login/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { monteur, profiel, beheerder } = await huidigeSessie();
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from('review_items')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');

  const botAan = monteur.actief && Boolean(profiel.whatsapp_nummer);

  return (
    <div className="schil">
      <header className="balk">
        <Link href="/" className="merk" title={botAan ? 'De bot staat aan' : 'De bot staat nog niet aan'}>
          <i className={botAan ? '' : 'uit'} aria-hidden="true" />
          Keukenbot
        </Link>
        <span className="zacht" style={{ fontSize: 13 }}>{monteur.bedrijfsnaam}</span>
        <Menu beheerder={beheerder} openSeintjes={count ?? 0} />
        <form action={uitloggen}>
          <button className="tweede klein">Uitloggen</button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
