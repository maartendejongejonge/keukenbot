/**
 * Postcodegebieden (pc4) als tekst invoeren en tonen.
 *
 *   "3011-3089, 3151, 3181, 3190-3199"  ⇄  [3011, 3012, …, 3089, 3151, …]
 */

export function leesPc4(tekst: string): { lijst: number[]; fout?: string } {
  const lijst = new Set<number>();
  const delen = tekst.split(/[,;\s]+/).map((d) => d.trim()).filter(Boolean);

  for (const deel of delen) {
    const m = deel.match(/^(\d{4})(?:\s*[-–]\s*(\d{4}))?$/);
    if (!m) return { lijst: [], fout: `"${deel}" is geen postcode van vier cijfers of reeks zoals 3011-3089.` };
    const van = Number(m[1]);
    const tot = m[2] ? Number(m[2]) : van;
    if (van < 1000 || tot > 9999 || tot < van) return { lijst: [], fout: `"${deel}" klopt niet.` };
    if (tot - van > 2000) return { lijst: [], fout: `"${deel}" is een erg grote reeks; klopt die?` };
    for (let p = van; p <= tot; p++) lijst.add(p);
  }

  return { lijst: [...lijst].sort((a, b) => a - b) };
}

export function toonPc4(lijst: number[] | null | undefined): string {
  if (!lijst?.length) return '';
  const s = [...new Set(lijst)].sort((a, b) => a - b);
  const uit: string[] = [];
  let begin = s[0];
  let vorige = s[0];
  for (const p of [...s.slice(1), Number.NaN]) {
    if (p === vorige + 1) { vorige = p; continue; }
    uit.push(begin === vorige ? String(begin) : `${begin}-${vorige}`);
    begin = p;
    vorige = p;
  }
  return uit.join(', ');
}

/** Een 4-cijferige postcode uit "3028 AB" of "3028". */
export function leesEenPc4(tekst: string): string | null {
  const m = tekst.trim().match(/^(\d{4})/);
  return m ? m[1] : null;
}
