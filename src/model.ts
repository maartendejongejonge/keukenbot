/**
 * Eén plek voor de aanroep van Claude. Gebruikt door de runner en door de
 * gesprekstest (npm run test:gesprekken).
 *
 * Mislukt het antwoord (HTTP-fout of geen bruikbare JSON), dan probeert hij
 * het één keer opnieuw. Lukt dat ook niet, dan komt er een lege uitkomst met
 * confidence 0 terug; de orchestrator maakt daar een veilig antwoord van.
 */

export interface ModelBericht {
  afzender: string;
  tekst: string;
}

export async function duidBericht(systeem: string, hist: ModelBericht[], bericht: string): Promise<any> {
  // De Messages API wil afwisselend user/assistant. Berichten van de monteur
  // zelf tellen als assistant; opeenvolgende gelijke rollen worden samengevoegd.
  const berichten: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const h of [...hist, { afzender: 'klant', tekst: bericht }]) {
    const role = h.afzender === 'klant' ? 'user' : 'assistant';
    const vorige = berichten[berichten.length - 1];
    if (vorige?.role === role) vorige.content += `\n\n${h.tekst}`;
    else berichten.push({ role, content: h.tekst });
  }
  if (berichten[0]?.role === 'assistant') berichten.shift();

  for (let poging = 1; poging <= 2; poging++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: systeem,
          messages: berichten,
        }),
      });

      const data: any = await res.json();
      if (!res.ok) {
        console.error(`Anthropic (poging ${poging}):`, res.status, data?.error?.message ?? '');
        continue;
      }

      const tekst = (data.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
        .replace(/```json|```/g, '')
        .trim();

      try {
        // Soms zet het model er toch een zin voor of na; pak het JSON-deel.
        return JSON.parse(tekst.slice(tekst.indexOf('{'), tekst.lastIndexOf('}') + 1));
      } catch {
        console.error(
          `Model gaf geen bruikbare JSON (poging ${poging}, stop_reason ${data.stop_reason}):`,
          tekst.slice(0, 500),
        );
      }
    } catch (e) {
      console.error(`Anthropic onbereikbaar (poging ${poging}):`, String(e));
    }
  }

  // Onbruikbaar antwoord is per definitie onbetrouwbaar.
  return { velden: {}, antwoord: '', confidence: 0 };
}
