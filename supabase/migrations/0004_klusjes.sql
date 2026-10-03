-- 0004 — klusjes buiten de keuken (lampen, gordijnrails, schilderijen)
-- Idempotent: veilig om opnieuw te draaien.
--
-- Een monteur die klusjes aanzet, neemt ze alleen tegen een hoog tarief.
-- De klant hoort nooit het uurtarief, alleen het bedrag voor een bezoek
-- (minimum_uren x uurtarief). Zonder instelling wijst de bot klusjes af.
-- Afgesproken met Maarten op 03-10-2026: € 95/uur, minimaal 2 uur (€ 190),
-- alleen binnen Rotterdam.

alter table monteur_profielen
  add column if not exists klusjes jsonb;   -- {"uurtarief":95,"minimum_uren":2,"incl_btw":true,"werkgebied_pc4":[...]}

alter table leads
  add column if not exists klusjes     text,
  add column if not exists klusje_uren numeric(4,1);

alter table afspraken drop constraint if exists afspraken_soort_check;
alter table afspraken add constraint afspraken_soort_check
  check (soort in ('inmeting','montage','klusje'));

update monteur_profielen p
set klusjes = jsonb_build_object(
      'uurtarief', 95,
      'minimum_uren', 2,
      'incl_btw', true,
      'werkgebied_pc4', to_jsonb(p.gratis_pc4)
    )
from monteurs m
where m.id = p.monteur_id
  and m.bedrijfsnaam = 'Rotterdam Keukenmontage';
