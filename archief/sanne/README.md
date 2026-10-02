# Archief: Supabase-bot "Sanne"

Opgeheven op 02-10-2026. Sanne was een WhatsApp-assistent voor Rotterdam
Keukenmontage als Supabase edge function (`whatsapp-webhook` + bedieningspaneel
`bot-admin`) in het bedrijfsproject `opzcylinzqpczebgmfty`. Hij is nooit actief
geweest (geen `ANTHROPIC_API_KEY`, `message_log` leeg).

Wat is overgenomen in de keukenbot:

- foto's en PDF's uitlezen → `src/media.ts`
- de gespreksregels → `src/kwalificatie.ts`, functie `systeemprompt`
- de prijsregels (bandbreedte, doorlooptijd, nooit uren tonen) → `src/prijs.ts`

Deze map staat hier alleen ter naslag en wordt niet gebouwd.
