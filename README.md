# Keukenbot

## Wat we maken

Software die andere zelfstandige keukenmonteurs kunnen huren, waarmee hun
klantaanvragen automatisch beantwoord worden en in hun agenda belanden.

Een monteur staat de hele dag met zijn handen in het werk. Juist in die uren
komen de aanvragen binnen via WhatsApp, Marktplaats of Zoofy, en juist dan kan
hij niet reageren. 's Avonds antwoordt hij op vijf berichten, waarvan er drie
al bij een ander zitten. Bij platformleads is snelheid van reageren letterlijk
het selectiecriterium.

De app is het loket dat wél altijd open is. Hij beantwoordt de aanvraag binnen
een minuut, vraagt uit wat voor klus het is, kijkt in de agenda van de monteur
en stelt een datum voor. De monteur hoort er pas van als er iets te beslissen
valt.

**De belofte in één zin:** je verliest geen aanvraag meer omdat je op je knieën
onder een aanrecht lag.

## Voor wie

Zelfstandige keukenmonteurs, één man, die via platforms en mond-tot-mond aan
hun klussen komen. Eerst voor Maartens eigen bedrijf (Rotterdam Keukenmontage),
daarna als betaald product voor anderen: € 49 tot € 89 per maand plus een
eenmalige inrichting van € 250.

Maarten is daarmee zowel de bouwer als de eerste gebruiker. Wat voor hem niet
werkt, is niet verkoopbaar aan anderen.

## Hoe het eindresultaat eruitziet

Een monteur meldt zich aan op een website, koppelt zijn WhatsApp-nummer en zijn
Google Agenda, vult zijn werkgebied en werktijden in, en is klaar. Er valt niets
te installeren; alles draait bij ons.

Vanaf dat moment:

1. Een klant stuurt een bericht.
2. De bot antwoordt binnen een minuut en stelt hooguit vijf vragen: waar,
   wat voor klus, is de keuken al geleverd, welk merk, hoe groot, zit er
   water- of elektrawerk bij, wanneer.
3. Past de klus niet in het werkgebied, dan volgt een nette afwijzing.
4. Past hij wel, dan kijkt de bot in de agenda en stelt drie momenten voor.
5. De klant kiest er één, en de afspraak staat in de agenda van de monteur.
6. Twijfelt de bot ergens over, dan zegt hij niets en krijgt de monteur een
   seintje met een voorstel voor een antwoord.

Dat laatste is de kern van het ontwerp: **de bot mag informeren, kwalificeren en
plannen, maar nooit een prijs noemen of iets toezeggen.** Alles waar twijfel in
zit gaat naar de monteur. Liever tien keer te veel overgedragen dan één klant
die een verkeerde belofte krijgt.

Offertes, meerwerk en facturen komen later. Eerst moet dit ene ding goed werken.

## Waar we nu staan

Het skelet is er: datamodel, kwalificatielogica, agendaregels en de
besluitvorming. Wat nog ontbreekt is het proces dat alles aan elkaar knoopt.

| Onderdeel | Status |
| --- | --- |
| Productplan | af |
| Datamodel (Supabase) | geschreven, nog niet gedraaid |
| Kwalificatie en harde grenzen | af |
| Agendaplanner | af |
| Google Agenda-koppeling | af, nog niet getest |
| Besluitvorming (orchestrator) | af |
| VPS ingericht | af |
| De runner die alles start | **nog te doen** |
| Melding aan de monteur bij overdracht | nog te doen |
| Webinterface voor monteurs | nog te doen |

## De bestanden

```
supabase/migrations/0001_init.sql   datamodel, per monteur gescheiden
src/kwalificatie.ts                 de zeven vragen, de harde grenzen, de toon
src/planner.ts                      werktijden, reistijd, buffer, vrije momenten
src/agenda.ts                       Google Agenda lezen en schrijven
src/orchestrator.ts                 bericht in → antwoord, afwijzing, voorstel of overdracht
src/transport.ts                    WhatsApp-verbinding, achter één interface
scripts/koppel-agenda.mjs           eenmalig een agenda koppelen
deploy/setup-vps.sh                 de server inrichten
deploy/keukenbot.service            zorgt dat de bot blijft draaien
api/whatsapp.ts                     voor later, bij de officiële WhatsApp API
```

## Waar het draait

Op een VPS bij TransIP (Ubuntu 26.04). Niet op Vercel: de WhatsApp-verbinding
moet permanent openstaan, en een serverless functie stopt zodra hij geantwoord
heeft.

De database staat bij Supabase, gescheiden van het bedrijfsproject van
Rotterdam Keukenmontage — klantgegevens van andere monteurs horen daar niet
tussen.

**Het prototype draait op een wegwerpnummer** via Baileys, een niet-officiële
koppeling. Dat mag voor testen met een nummer dat er niet toe doet. Zodra er
een betalende klant is, gaat het over op de officiële WhatsApp Business API:
zijn nummer aan een koppeling hangen die geblokkeerd kan worden, is zijn
telefoon en jouw schuld. `transport.ts` zit er tussen zodat die overstap geen
herbouw betekent.

## Standaardwaarden

Elke nieuwe monteur begint met: ma–vr, 07:30–17:00, geen werkgebiedfilter,
inmeting 90 minuten, montage 3 werkdagen. Hij past ze zelf aan bij de
onboarding; `profiel_ingevuld` blijft `false` tot hij dat gedaan heeft.

Die drie dagen hebben gevolgen voor de planner: een montage past niet in een
gat tussen twee klussen door. De planner zoekt daarom een reeks aaneengesloten
vrije werkdagen, waarbij een half bezette dag als bezet telt. Voor inmetingen
zoekt hij wel gaten binnen één dag.

## De volgorde

1. ~~VPS inrichten~~ — gedaan
2. ~~Google Agenda koppelen~~ — gedaan
3. Supabase-project aanmaken en de migratie draaien
4. De runner schrijven en de bot laten draaien
5. **Meelezen zonder antwoorden**: een week lang gaat elk besluit naar de
   monteur in plaats van naar de klant
6. Pas daarna echt laten antwoorden

Stap 5 is niet optioneel. Je ziet er precies aan wat de bot zou hebben gezegd,
zonder één klant te riskeren — en het is meteen je verkoopmateriaal voor de
gesprekken met andere monteurs.
