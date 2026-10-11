-- 0009 — offertevoorstel na inplannen (zie src/offerte.ts)
-- Idempotent: veilig om opnieuw te draaien.
--
-- 11-10-2026, Maarten: na het inplannen van een montage maakt Pico een
-- offerte (bovenkant marktconform) en stuurt die als CONCEPT naar het
-- meldnummer van de monteur. Pico stuurt nooit een offerte naar de klant.
--
-- monteur_profielen.offerte (jsonb):
--   {"aan": true, "naam": "...", "juridisch": "...", "regel": "...", "web": "...",
--    "adres": "...", "postcode_plaats": "...", "kvk": "...", "btw_id": "...",
--    "meerwerk_uurtarief": 56, "geldig_dagen": 30, "tarieven": {...}}
-- Telefoon en e-mail komen uit monteurs (telefoon, email) tenzij hier gezet.
-- Adres, KvK en btw-id staan NIET in deze openbare repo: die zet je zelf in
-- de SQL-editor van Supabase (zie README, "Offertevoorstel").
-- Standaard uit; Rotterdam Keukenmontage aan.

alter table monteur_profielen
  add column if not exists offerte jsonb;

update monteur_profielen p
set offerte = coalesce(p.offerte, '{}'::jsonb) || '{
      "aan": true,
      "naam": "Rotterdam Keukenmontage",
      "juridisch": "M.P.J. de Jonge",
      "regel": "Keukenmontage & elektrotechniek",
      "web": "rotterdam-keukenmontage.nl",
      "meerwerk_uurtarief": 56
    }'::jsonb
from monteurs m
where m.id = p.monteur_id
  and m.bedrijfsnaam = 'Rotterdam Keukenmontage';
