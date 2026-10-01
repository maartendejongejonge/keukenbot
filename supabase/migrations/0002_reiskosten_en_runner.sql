-- Samenvatting van wat op 19 sep 2026 al los in Supabase is gedraaid
-- (hersteldag_na_meerdaagse, reiskosten_velden, hotel_richtprijs), zodat de
-- repo weer klopt met de database. Idempotent: veilig om opnieuw te draaien.

alter table monteur_profielen
  add column if not exists vertrek_postcode        text,                -- pc4 waar hij 's ochtends vertrekt
  add column if not exists km_tarief               numeric(5,2) not null default 0.35,
  add column if not exists uurtarief               numeric(6,2),
  add column if not exists reisuur_percentage      int  not null default 50,
  add column if not exists gratis_pc4              int[] not null default '{}',
  add column if not exists hotel_richtprijs        numeric(6,2) not null default 90,
  add column if not exists hersteldag_na_meerdaagse boolean not null default true;

alter table leads
  add column if not exists afstand_km   numeric(6,1),
  add column if not exists rijtijd_min  int,
  add column if not exists reiskosten   numeric(8,2);

-- vindOfMaakLead zoekt per monteur op telefoonnummer.
create index if not exists leads_monteur_telefoon on leads (monteur_id, klant_telefoon);
