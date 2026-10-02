-- 0003 — prijsindicatie per monteur, gespreksgegevens voor de prijs, media
-- Idempotent: veilig om opnieuw te draaien.
--
-- Prijzen staan standaard UIT. Een monteur krijgt pas een prijsindicatie in
-- zijn bot als hij zelf prijzen_tonen aanzet én een uurtarief én eigen
-- uurnormen heeft ingevuld. Tot 02-10-2026 alleen Rotterdam Keukenmontage.

alter table monteur_profielen
  add column if not exists prijzen_tonen  boolean not null default false,
  add column if not exists uurnormen      jsonb,                 -- zie src/prijs.ts → Uurnormen
  add column if not exists aanspreeknaam  text,                  -- naam waaronder klanten de monteur kennen
  add column if not exists advies         text[] not null default '{}'; -- adviezen die de bot mag meegeven

alter table leads
  add column if not exists verdieping     int,
  add column if not exists lift           boolean,
  add column if not exists leverdatum     date,
  add column if not exists werkblad_door  text check (werkblad_door in ('monteur','steenhouwer','klant')),
  add column if not exists ingemeten      boolean,
  add column if not exists zakelijk       boolean,
  add column if not exists werk           jsonb not null default '{}'::jsonb,
  add column if not exists prijs_min      numeric(8,2),
  add column if not exists prijs_max      numeric(8,2),
  add column if not exists prijs_incl_btw boolean,
  add column if not exists dagen_min      int,
  add column if not exists dagen_max      int,
  add column if not exists prijs_uren     numeric(6,1),
  add column if not exists prijs_gegeven_op timestamptz;

-- ------------------------------------------- Rotterdam Keukenmontage aanzetten

update monteur_profielen p
set prijzen_tonen = true,
    aanspreeknaam = 'Jos',
    uurnormen = '{
      "kast_bouwpakket":     {"onder": 0.75, "hang": 0.6,  "hoog": 1.25},
      "kast_voorgemonteerd": {"onder": 0.25, "hang": 0.25, "hoog": 0.5},
      "grens_kasten": 10,
      "stellen_ophangen": {"klein": 3,   "groot": 4},
      "fronten_plinten":  {"klein": 4,   "groot": 6},
      "opruimen":         {"klein": 1.5, "groot": 2},
      "werkblad": 3,
      "werkblad_hoek_extra": 1,
      "eiland_extra": 3,
      "water_basis": 1.5,
      "waterpunt": 0.75,
      "apparaat": 0.75,
      "kookplaat": 1,
      "verdieping_zonder_lift": 0.5,
      "uren_per_dag": 8,
      "bandbreedte_pct": 10
    }'::jsonb,
    advies = array[
      'Elektra-aansluitingen (kookplaat, groep) doet een gecertificeerd elektricien uit ons team. De klant hoeft geen aparte elektricien te regelen.',
      'Bij zwaar tilwerk, zoals een keramisch of natuurstenen werkblad, regelen wij extra mankracht.'
    ],
    -- Alleen Rotterdam zelf is gratis; Schiedam, Vlaardingen en Maassluis
    -- (311x–314x) niet. Rotterdam: 3011–3089, Hoek van Holland 3151,
    -- Rozenburg 3181, Hoogvliet/Pernis 3190–3199.
    gratis_pc4 = array(
      select g from generate_series(3011, 3089) g
      union all select 3151
      union all select 3181
      union all select g from generate_series(3190, 3199) g
    )
from monteurs m
where m.id = p.monteur_id
  and m.bedrijfsnaam = 'Rotterdam Keukenmontage';
