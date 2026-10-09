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
6. Pas dan neemt de monteur het gesprek over. Daarvoor krijgt hij hooguit een
   seintje (prijsbezwaar, klacht, twijfel), maar de bot praat gewoon verder.

De kern van het ontwerp (besloten 02-10-2026): **de bot verkoopt de klus, de
monteur hoeft niet te verkopen.** De bot draagt pas over als er een datum is
ingepland. Alleen als er acht weken lang geen vrije datum is, of als het
wegschrijven in de agenda mislukt, gaat het eerder naar de monteur. Wat de bot
nooit doet: zelf een datum toezeggen die niet uit de agenda komt, of een bedrag
noemen dat niet uit de prijsberekening komt.

**Prijzen** noemt de bot standaard niet. Uitzondering: een monteur die in zijn
profiel `prijzen_tonen` aanzet en zijn eigen `uurtarief` en `uurnormen` invult.
Dan rekent `src/prijs.ts` bij een keukenmontage een bandbreedte en doorlooptijd
uit (nooit uren of uurtarief naar de klant). Sinds 02-10-2026 staat dat alleen
aan voor Rotterdam Keukenmontage. Werk zonder uurnorm (leidingwerk, groep
aanleggen, slopen) gaat altijd naar de monteur.

## Gespreksregels (afgesproken 02-10-2026)

- Eerst vragen om de onderdelenlijst en plattegrond (foto of PDF); die worden
  automatisch uitgelezen (`src/media.ts`). Daarna alleen vragen wat ontbreekt:
  postcode, verdieping en lift, wie het werkblad plaatst, leverdatum.
- Zo kort mogelijk. Geen complimenten. Eerlijk een AI, niet menselijk doen.
  Korte bevestigingsvragen mogen.
- Advies (elektricien uit eigen team, extra mankracht bij zwaar blad) komt uit
  het profiel (`advies`), net als wat de monteur niet doet (`weigert`).
- Na de prijs: montagedag voorstellen, niet "accepteert u de offerte?".
  Inmeten alleen als dat nog niet gebeurd is.
- Prijsbezwaar: niet in discussie, onderbouwen, laten doorschemeren dat de
  klant het bedrag met de monteur (`aanspreeknaam`) kan bespreken. Geen korting.
  De monteur krijgt een seintje, de bot praat verder.
- Werk zonder uurnorm (leidingwerk, groep aanleggen): de bot geeft de prijs
  voor de montage en zegt dat dat werk er apart bij komt in de offerte.
- Wil de klant liever met de monteur zelf praten: staat
  `telefoon_voor_klanten` aan (webinterface, bij "Jij"), dan geeft de bot het
  nummer van de monteur, met de kanttekening dat hij overdag aan het werk is.
  Staat het uit, dan neemt de monteur contact op zodra de datum staat
  (09-10-2026). Seintje `wil_monteur` in beide gevallen.
- Geen systeemwoorden tegen de klant ("bijschrift", "bestand", "systeem").
- Vraagt de klant om werk te verzinnen of op een bedrag uit te komen: niet
  beschuldigen, wel zeggen dat alleen nodig werk op de offerte komt, en
  vragen of het nodig is (bij elektra: foto van de meterkast).
- Past geen van de voorgestelde data: de bot zoekt zelf nieuwe, later.
- Meerdere berichten of bestanden achter elkaar worden gebundeld en in één
  keer beantwoord (`BUNDEL_SECONDEN`, standaard 15). Alle foto's en PDF's uit
  zo'n bundel worden in één aanroep samen uitgelezen (08-10-2026), zodat een
  lijst over drie foto's als één lijst geteld wordt en ontbrekende pagina's
  opvallen. Model: `CLAUDE_MODEL_MEDIA` (los van het gespreksmodel).
- De voorgestelde momenten zijn genummerd. Kiest de klant er één (nummer of
  eigen woorden), dan gaat de afspraak in Google Agenda, vervallen de andere
  reserveringen en krijgt de monteur een bevestiging. Past geen moment, dan
  gaat het gesprek naar de monteur.
- Na een ingeplande afspraak (of de zeldzame overdracht) antwoordt de bot die klant niet
  meer; nieuwe berichten gaan door naar de monteur (14 dagen na overdracht,
  60 dagen na inplannen). De monteur antwoordt zelf vanaf het botnummer.

- Antwoorden in de taal van de klant (Nederlands in de u-vorm, of Engels).
  Geen dagdeelgroet: de bot weet niet hoe laat het bij de klant is.
- Komt de keuken pas over weken of maanden: leverdatum vragen en nu al
  plannen, nooit "laat maar weten als hij er is".
- Een bedrijf dat structureel wil samenwerken (keukenhandel, aannemer):
  geen toezeggingen, seintje `wil_monteur`.
- Weet de bot iets niet zeker (onduidelijke foto's, onvolledige lijst), dan
  draagt hij niet over maar vraagt hij steeds gerichter: alle
  onderdelenlijsten en tekeningen, dan de volledige bestellijst als PDF, dan
  de aantallen kasten getypt. Nooit twee keer hetzelfde bericht. Is die
  ladder op, dan krijgt de monteur een seintje en praat de bot verder
  (08-10-2026; vervangt de overdracht bij vastlopen van 07-10-2026).
- Elk aanrechtblad wordt afgekit; dat zit als vaste post in de
  prijsindicatie (`kitwerk`, `kitwerk_hoek_extra`). Bouwpakketkasten (IKEA)
  rekenen sinds 08-10-2026 met 1,5 / 1 / 2,5 uur per onder-, hang- en hoge kast.
- Een seintje blijft kort (laatste bericht). Elke overdracht en elke inplanning
  bevat het volledige gesprek,
  en de foto's en PDF's van de klant komen als bijlage mee (alleen de bestanden
  die de monteur nog niet had). De runner bewaart ze 60 dagen in
  `/opt/keukenbot/bestanden` (`src/bestanden.ts`), niet in de database.

## Klusjes buiten de keuken (besloten 03-10-2026)

Lampen, gordijnrails, schilderijen en ander klein werk: zonder instelling
wijst de bot dit netjes af. Een monteur die `klusjes` in zijn profiel zet,
neemt ze alleen tegen een hoog tarief aan. Rotterdam Keukenmontage: € 95 per
uur, minimaal 2 uur, alleen binnen Rotterdam (`werkgebied_pc4`). De klant
hoort nooit het uurtarief, alleen dat een bezoek € 190 kost en dat er bij
meer werk naar verhouding tijd bijkomt. De bot vraagt wat, waar en wanneer,
schat de duur in voor de planning (minimaal 2, maximaal 8 uur) en stelt drie
momenten voor. In de agenda heet zo'n afspraak "Klusje".

## Tweedehands, transport en budget (besloten 03-10-2026)

- **Bouwpakket of voorgemonteerd** vraagt de bot bijna nooit: IKEA is een
  bouwpakket (tenzij de klant de kasten zelf in elkaar zet), Nobilia en
  andere nieuwe keukens van een keukenzaak komen voorgemonteerd.
- **Tweedehands keukens** hebben geen onderdelenlijst. De bot vraagt foto's
  van de keuken zoals hij nu staat, telt de kasten (of vraagt het aantal),
  en vraagt of demontage bij de verkoper en vervoer erbij moeten. Die gaan
  als werk zonder uurnorm apart in de offerte.
- **Transport** (`transport` in het profiel): de bot mag noemen dat vervoer
  € 200 autohuur plus € 85 per uur kost. Verticaal transport kan geregeld
  worden via een andere partij; die kosten zijn voor de klant en de bot noemt
  geen bedrag.
- **Budget te laag**: kan de klant het bedrag echt niet betalen, dan
  onderhandelt de bot niet maar zegt hij dat hij het doorgeeft, en gaat het
  gesprek naar de monteur (signaal `budget`, ook tijdens het kiezen van een
  moment). Gewoon "het is duur" blijft een prijsbezwaar waar de bot zelf op
  antwoordt.

## Gesprekstest

`test/voorbeeldgesprekken.json` bevat 11 echte, geanonimiseerde
klantgesprekken van Maarten. De test speelt de klantberichten af tegen de
echte prompt en het echte profiel, met een lege agenda, zonder iets te
versturen of op te slaan:

```bash
sudo -u keukenbot -H bash -c 'cd /opt/keukenbot && npm run test:gesprekken'
```

De uitslag staat daarna in `test/uitslag.md`: per beurt wat de bot zegt,
wat Maarten destijds zei, en waarop je het antwoord beoordeelt. Draai hem na
elke wijziging aan de prompt.

## Uitleestest

`npm run test:uitlezen` laat zien wat Pico uit documenten en foto's haalt.
Zet ze op de server in `/opt/keukenbot/test/bestanden/` (niet in GitHub:
klantgegevens). Elk bestand wordt los uitgelezen; per bestand zie je de
samenvatting en de telling, en controleer je zelf of het klopt. Alles staat
daarna ook in `test/bestanden/uitslag.md`. Met `-- ikea` lees je alleen
bestanden met dat woord in de naam. Optioneel: een `verwacht.json` (zie
`test/bestanden.voorbeeld.json`) om automatisch te vergelijken.

Offertes, meerwerk en facturen komen later. Eerst moet dit ene ding goed werken.

## Stresstest met vrienden (05-10-2026)

De nummers van de testers staan in `TESTNUMMERS` in `/opt/keukenbot/.env`
(komma's ertussen, 06-nummers mogen). Niet in de code: deze repo is openbaar.
Voor die nummers wijkt de bot op vier punten af van een echte klant:

- **`reset`** (alleen dat woord) wist het gesprek en de reserveringen; de
  tester kan opnieuw beginnen als nieuwe klant.
- **Na inplannen of overdracht** zwijgt de bot niet, maar meldt hij dat het
  gesprek is afgerond en behandelt hij het volgende bericht als nieuwe aanvraag.
- **Afspraken** komen in Google Agenda met `[TEST]` voor de titel, in grafiet.
  Die blijven staan tot je ze zelf weggooit (ze houden dat moment bezet).
- **Na een update** krijgt elke tester: "De keukenbot is geüpdatet en
  verbeterd. U kunt mij nu als testpersoon opnieuw stresstesten." Hun oude
  gesprekken worden daarbij gewist. Dat gebeurt alleen als de git-versie anders
  is dan bij de vorige melding (`laatste-testmelding.txt`), dus niet bij een
  gewone herstart. Jij krijgt een bevestiging met het versienummer.

Seintjes en meldingen aan de monteur blijven zoals bij een echte klant.

**Zelf testen met je eigen nummer:** zet je eigen nummer in `TESTNUMMERS`.
Dan behandelt de bot jouw berichten als die van een klant, ook al is het je
meldnummer. Seintjes en meldingen komen in hetzelfde gesprek binnen. Haal je
nummer er na het testen weer uit.

## Waar we nu staan

Het skelet is er: datamodel, kwalificatielogica, agendaregels en de
besluitvorming. Wat nog ontbreekt is het proces dat alles aan elkaar knoopt.

| Onderdeel | Status |
| --- | --- |
| Productplan | af |
| Datamodel (Supabase) | gedraaid, profiel en kanaal van Rotterdam Keukenmontage staan erin |
| Kwalificatie en harde grenzen | af |
| Agendaplanner | af |
| Reiskosten | af |
| Google Agenda-koppeling | af, test met `npm run check` |
| Besluitvorming (orchestrator) | af |
| VPS | herinstalleerd en ingericht op 1 okt 2026 |
| De runner die alles start | af, nog niet live gezet |
| Melding aan de monteur bij overdracht | af (via WhatsApp, in de runner) |
| Foto's en PDF's uitlezen | af (overgenomen uit Sanne, 02-10-2026) |
| Prijsindicatie per monteur | af, alleen aan voor Rotterdam Keukenmontage |
| Klant kiest een moment → Google Agenda | af (02-10-2026) |
| Bot zwijgt na overdracht of inplannen | af (02-10-2026) |
| Klusjes tegen hoog tarief | af (03-10-2026), alleen aan voor Rotterdam Keukenmontage |
| Gesprekstest met echte gesprekken | af (03-10-2026) |
| Tweedehands, transport, budget naar monteur | af (03-10-2026) |
| Stresstest met vrienden | goedgekeurd (06-10-2026) |
| Webinterface voor monteurs | gebouwd (06-10-2026), nog op Vercel zetten; zie `web/README.md` |
| Meerdere WhatsApp-nummers in de runner | nog te doen (of meteen de officiële API) |

## De bestanden

```
src/runner.ts                       het proces op de VPS: knoopt alles aan elkaar
src/check.ts                        controleert .env en alle koppelingen (npm run check)
src/kwalificatie.ts                 de vragen, de harde grenzen, de gespreksregels (systeemprompt)
src/model.ts                        de aanroep van Claude (met één herkansing)
src/gesprekken.test.ts              echte gesprekken afspelen tegen de bot (npm run test:gesprekken)
test/voorbeeldgesprekken.json       11 geanonimiseerde klantgesprekken
src/prijs.ts                        prijsindicatie uit uurnormen (alleen als de monteur dat aanzet)
src/prijs.test.ts                   rekentest op de referentiekeukens (npm run test:prijs)
src/media.ts                        foto's en PDF's van klanten laten uitlezen (per bundel samen)
src/uitlezen.test.ts                uitleestest op echte lijsten (npm run test:uitlezen)
src/bestanden.ts                    bestanden van klanten bewaren en doorsturen naar de monteur
src/keuze.ts                        welk voorgesteld moment kiest de klant
src/planner.ts                      werktijden, reistijd, buffer, vrije momenten
src/reiskosten.ts                   afstand, rijtijd en reiskosten per postcode
src/agenda.ts                       Google Agenda lezen en schrijven
src/orchestrator.ts                 bericht in → antwoord, afwijzing, voorstel of overdracht
src/transport.ts                    WhatsApp-verbinding (Baileys), achter één interface
src/testers.ts                      testnummers, reset en updatebericht voor de stresstest
supabase/migrations/                datamodel, per monteur gescheiden
scripts/koppel-agenda.mjs           eenmalig een agenda koppelen (op je laptop)
deploy/setup-vps.sh                 een verse server inrichten (één keer)
deploy/installeer-app.sh            code ophalen, bouwen, service installeren (ook voor updates)
deploy/env.voorbeeld                sjabloon voor /opt/keukenbot/.env
deploy/keukenbot.service            zorgt dat de bot blijft draaien
api/whatsapp.ts                     voor later, bij de officiële WhatsApp API
archief/sanne/                      de opgeheven Supabase-bot, alleen ter naslag
web/                                de webinterface voor monteurs (Next.js op Vercel), zie web/README.md
```

## Op de server zetten of bijwerken

Inloggen als je eigen gebruiker (niet `keukenbot`, die heeft geen sudo):

```bash
ssh maartendejonge24@149.210.205.238
cd ~/keukenbot && git pull
sudo bash deploy/installeer-app.sh
sudo -u keukenbot -H bash -c 'cd /opt/keukenbot && npm run check'
sudo systemctl start keukenbot
journalctl -u keukenbot -f
```

De eerste start toont een KOPPELCODE in het logboek. Die typ je over op de
telefoon met het wegwerpnummer: WhatsApp → Gekoppelde apparaten → Apparaat
koppelen → Koppelen met telefoonnummer.

## Waar het draait

Op een VPS bij TransIP (Ubuntu 26.04), in `/opt/keukenbot`, als gebruiker `keukenbot`. Niet op Vercel: de WhatsApp-verbinding
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
3. ~~Supabase-project aanmaken en de migratie draaien~~ — gedaan
4. ~~De runner schrijven en live zetten~~ — live sinds 05-10-2026
5. ~~Stresstest met vrienden~~ (in plaats van een week meelezen) — goedgekeurd 06-10-2026
6. **Webinterface live zetten** (`web/README.md`) en zelf als eerste gebruiker
   inloggen, je meldnummer invullen en je agenda via de site koppelen
7. De runner meerdere WhatsApp-nummers laten bedienen, of overstappen op de
   officiële WhatsApp Business API, en dan de eerste andere monteur
