-- 0007 — hogere uurnormen voor bouwpakketkeukens (IKEA) en kitwerk
-- Idempotent: veilig om opnieuw te draaien.
--
-- 08-10-2026, Maarten: bij IKEA-keukens rekende de bot veel te weinig uren,
-- en het afkitten van het aanrechtblad ontbrak. Elk blad wordt afgekit.
-- Alleen Rotterdam Keukenmontage; andere monteurs stellen dit zelf in via
-- de webinterface (zonder waarde rekent src/prijs.ts met 1 + 0,5 uur kitwerk).

update monteur_profielen p
set uurnormen = p.uurnormen
  || '{
        "kast_bouwpakket":    {"onder": 1.5, "hang": 1, "hoog": 2.5},
        "kitwerk":            1,
        "kitwerk_hoek_extra": 0.5
      }'::jsonb
from monteurs m
where m.id = p.monteur_id
  and m.bedrijfsnaam = 'Rotterdam Keukenmontage'
  and p.uurnormen is not null;
