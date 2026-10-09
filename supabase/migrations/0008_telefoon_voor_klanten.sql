-- 0008 — klanten mogen het nummer van de monteur krijgen
-- Idempotent: veilig om opnieuw te draaien.
--
-- 09-10-2026, Maarten: wil een klant liever met de monteur zelf praten, dan
-- mag de bot het nummer geven. Het nummer zelf staat in monteurs.telefoon
-- (het meldnummer uit de webinterface), niet in deze openbare repo.
-- Standaard uit; Rotterdam Keukenmontage aan.

alter table monteur_profielen
  add column if not exists telefoon_voor_klanten boolean not null default false;

update monteur_profielen p
set telefoon_voor_klanten = true
from monteurs m
where m.id = p.monteur_id
  and m.bedrijfsnaam = 'Rotterdam Keukenmontage';

-- De webinterface mag de instelling lezen en wijzigen (zie 0006).
grant select (telefoon_voor_klanten) on monteur_profielen to authenticated;
grant update (telefoon_voor_klanten) on monteur_profielen to authenticated;
