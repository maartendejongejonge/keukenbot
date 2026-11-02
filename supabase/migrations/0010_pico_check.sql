-- Avondcheck van Pico (02-11-2026).
-- pico_checks: één rij per controle, zodat de volgende controle weet waar
--   hij gebleven was en wat er al is aangepast.
-- pico_geheimen: het GitHub-token waarmee de avondcheck verbeteringen pusht.
--   RLS aan en GEEN policies: de bot en de webinterface kunnen er niet bij,
--   alleen de service-role / beheer-API.

create table if not exists pico_checks (
  id            bigint generated always as identity primary key,
  gedaan_op     timestamptz not null default now(),
  tot           timestamptz not null,          -- berichten tot dit moment bekeken
  gesprekken    int not null default 0,
  bevindingen   text,                          -- kort, zonder klantgegevens
  commits       text[],                        -- uitgerolde verbeteringen
  voor_maarten  text                           -- wat een besluit van Maarten vraagt
);
alter table pico_checks enable row level security;

create table if not exists pico_geheimen (
  naam    text primary key,
  waarde  text not null,
  gezet_op timestamptz not null default now()
);
alter table pico_geheimen enable row level security;
