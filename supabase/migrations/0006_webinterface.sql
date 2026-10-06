-- 0006 — webinterface voor monteurs
-- Idempotent: veilig om opnieuw te draaien.
--
-- Een monteur logt in via Supabase Auth (link per e-mail, alleen op
-- uitnodiging). Zijn login hangt aan zijn rij in `monteurs` via
-- auth_user_id; de eerste keer inloggen koppelt de webapp die op e-mailadres.
--
-- Wat de monteur vanuit de browser mag:
--   lezen   : zijn eigen monteur, profiel, kanalen, leads, berichten, afspraken, seintjes
--   wijzigen: zijn contactgegevens, zijn profielinstellingen, de status van een seintje
-- Al het andere (WhatsApp-nummer, abonnement, Google-tokens, berichten
-- schrijven) loopt alleen via de server met de service role.

-- ---------------------------------------------------------------- koppeling

alter table monteurs
  add column if not exists auth_user_id   uuid unique references auth.users(id) on delete set null,
  add column if not exists uitgenodigd_op timestamptz;

alter table monteur_profielen
  add column if not exists google_gekoppeld_op timestamptz,
  add column if not exists google_email        text;

-- Google-tokens staan apart, zonder policies: alleen de service role (runner
-- en webserver) kan ze lezen. Zo kan een fout in een browserquery nooit een
-- refresh token lekken.
create table if not exists google_koppelingen (
  monteur_id    uuid primary key references monteurs(id) on delete cascade,
  refresh_token text not null,
  agenda_id     text not null default 'primary',
  email         text,
  bijgewerkt_op timestamptz not null default now()
);
alter table google_koppelingen enable row level security;

-- monteur_profielen.google_refresh (uit 0001) blijft bestaan maar wordt niet
-- meer gebruikt; de browser kan hem niet lezen (zie kolomrechten hieronder).

-- De toon gaat letterlijk de systeemprompt in; houd hem kort.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'toon_lengte') then
    alter table monteur_profielen add constraint toon_lengte check (char_length(toon) <= 200);
  end if;
end $$;

-- ---------------------------------------------------------------- wie ben ik

create or replace function public.mijn_monteur_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.monteurs where auth_user_id = auth.uid()
$$;
revoke all on function public.mijn_monteur_id() from public, anon;
grant execute on function public.mijn_monteur_id() to authenticated;

-- ---------------------------------------------------------------- policies
-- De policies uit 0001 vergeleken auth.uid() met monteurs.id. Nu via
-- mijn_monteur_id(). Ze blijven 'for all'; wat wel en niet mag, bepalen de
-- kolomrechten hieronder.

alter policy eigen_monteur   on monteurs          to authenticated using (id = (select public.mijn_monteur_id())) with check (id = (select public.mijn_monteur_id()));
alter policy eigen_profiel   on monteur_profielen to authenticated using (monteur_id = (select public.mijn_monteur_id())) with check (monteur_id = (select public.mijn_monteur_id()));
alter policy eigen_kanalen   on kanalen           to authenticated using (monteur_id = (select public.mijn_monteur_id())) with check (monteur_id = (select public.mijn_monteur_id()));
alter policy eigen_leads     on leads             to authenticated using (monteur_id = (select public.mijn_monteur_id())) with check (monteur_id = (select public.mijn_monteur_id()));
alter policy eigen_afspraken on afspraken         to authenticated using (monteur_id = (select public.mijn_monteur_id())) with check (monteur_id = (select public.mijn_monteur_id()));
alter policy eigen_review    on review_items      to authenticated using (monteur_id = (select public.mijn_monteur_id())) with check (monteur_id = (select public.mijn_monteur_id()));
alter policy eigen_berichten on berichten         to authenticated
  using (exists (select 1 from leads l where l.id = berichten.lead_id and l.monteur_id = (select public.mijn_monteur_id())))
  with check (exists (select 1 from leads l where l.id = berichten.lead_id and l.monteur_id = (select public.mijn_monteur_id())));

-- ---------------------------------------------------------------- kolomrechten
-- Policies bepalen welke rijen; grants bepalen welke kolommen.

revoke all on monteurs, monteur_profielen, kanalen, leads, berichten,
              afspraken, review_items, google_koppelingen from anon, authenticated;

grant select on monteurs, kanalen, leads, berichten, afspraken, review_items to authenticated;

-- Alle profielkolommen behalve google_refresh.
grant select (
  monteur_id, werkgebied_pc4, max_reistijd_min, werkdagen, werkdag_start, werkdag_eind,
  buffer_dagdelen, inmeting_duur_min, montage_duur_dagdelen, profiel_ingevuld, toon, weigert,
  google_agenda_id, whatsapp_nummer, whatsapp_phone_id, hersteldag_na_meerdaagse,
  vertrek_postcode, km_tarief, uurtarief, reisuur_percentage, gratis_pc4, hotel_richtprijs,
  prijzen_tonen, uurnormen, aanspreeknaam, advies, klusjes, transport,
  google_gekoppeld_op, google_email
) on monteur_profielen to authenticated;

grant update (contactnaam, telefoon) on monteurs to authenticated;

grant update (
  aanspreeknaam, toon, weigert, advies,
  werkdagen, werkdag_start, werkdag_eind,
  vertrek_postcode, werkgebied_pc4, max_reistijd_min,
  inmeting_duur_min, montage_duur_dagdelen, buffer_dagdelen, hersteldag_na_meerdaagse,
  km_tarief, reisuur_percentage, gratis_pc4, hotel_richtprijs,
  prijzen_tonen, uurtarief, uurnormen,
  klusjes, transport,
  profiel_ingevuld
) on monteur_profielen to authenticated;

grant update (status, afgehandeld_op) on review_items to authenticated;

create index if not exists leads_monteur_laatste on leads (monteur_id, laatste_bericht_op desc);
create index if not exists review_monteur_status on review_items (monteur_id, status);
create index if not exists afspraken_monteur_start on afspraken (monteur_id, start_op);
