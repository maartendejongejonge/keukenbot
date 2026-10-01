-- Keukenbot fase 1 — multi-tenant fundament
-- Eén rij in `monteurs` = één betalende klant. Alles hangt aan monteur_id.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- monteurs

create table monteurs (
  id                uuid primary key default gen_random_uuid(),
  bedrijfsnaam      text not null,
  contactnaam       text not null,
  email             text not null unique,
  telefoon          text,
  abonnement        text not null default 'basis'
                    check (abonnement in ('basis','plus','ploeg')),
  actief            boolean not null default true,
  aangemaakt_op     timestamptz not null default now()
);

-- Instelbaar profiel per monteur.
-- ALLE defaults hieronder zijn startwaarden voor een nieuwe tenant. De monteur
-- overschrijft ze tijdens de onboarding met zijn eigen gegevens; de app hoort
-- nooit op deze waarden te blijven draaien.
create table monteur_profielen (
  monteur_id        uuid primary key references monteurs(id) on delete cascade,
  werkgebied_pc4    int[] not null default '{}',        -- leeg = geen filter, alles wordt aangenomen
  max_reistijd_min  int  not null default 45,
  werkdagen         int[] not null default '{1,2,3,4,5}', -- 1 = maandag
  werkdag_start     time not null default '07:30',
  werkdag_eind      time not null default '17:00',
  buffer_dagdelen   int  not null default 1,            -- per week vrijhouden voor uitloop
  inmeting_duur_min int  not null default 90,
  montage_duur_dagdelen int not null default 6,         -- 3 werkdagen, één monteur
  profiel_ingevuld  boolean not null default false,     -- false = nog op defaults
  toon              text not null default 'nuchter, beleefd, kort',
  weigert           text[] not null default '{}',       -- klussen die hij niet doet
  google_agenda_id  text,
  google_refresh    text,                               -- encrypted at rest
  whatsapp_nummer   text,
  whatsapp_phone_id text
);

-- ------------------------------------------------------------------ kanalen

create table kanalen (
  id                uuid primary key default gen_random_uuid(),
  monteur_id        uuid not null references monteurs(id) on delete cascade,
  soort             text not null check (soort in ('whatsapp','webformulier','email_doorstuur')),
  externe_id        text,                               -- phone_number_id, formulier-sleutel, inbox-adres
  actief            boolean not null default true,
  unique (monteur_id, soort, externe_id)
);

-- -------------------------------------------------------------------- leads

create table leads (
  id                uuid primary key default gen_random_uuid(),
  monteur_id        uuid not null references monteurs(id) on delete cascade,
  kanaal_id         uuid references kanalen(id) on delete set null,
  klant_naam        text,
  klant_telefoon    text,
  klant_email       text,
  status            text not null default 'nieuw'
                    check (status in ('nieuw','kwalificeren','gekwalificeerd',
                                      'afgewezen','ingepland','overgedragen','verlopen')),
  -- de zeven kwalificatievelden; null = nog niet uitgevraagd
  pc4               int,
  plaats            text,
  type_klus         text,   -- montage | ombouw | losse_kast | reparatie
  leverancier       text,
  omvang            text,   -- aantal kasten of strekkende meter, vrij veld
  installatiewerk   text[], -- water, elektra, afvoer, quooker
  keuken_geleverd   boolean,
  gewenste_periode  text,
  afwijsreden       text,
  laatste_bericht_op timestamptz,
  aangemaakt_op     timestamptz not null default now()
);

create index on leads (monteur_id, status);
create index on leads (monteur_id, laatste_bericht_op desc);

-- ---------------------------------------------------------------- berichten

create table berichten (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references leads(id) on delete cascade,
  richting          text not null check (richting in ('in','uit')),
  afzender          text not null check (afzender in ('klant','bot','monteur')),
  tekst             text not null,
  confidence        numeric(3,2),                       -- alleen bij afzender = bot
  verzonden_op      timestamptz not null default now()
);

create index on berichten (lead_id, verzonden_op);

-- --------------------------------------------------------------- afspraken

create table afspraken (
  id                uuid primary key default gen_random_uuid(),
  monteur_id        uuid not null references monteurs(id) on delete cascade,
  lead_id           uuid not null references leads(id) on delete cascade,
  soort             text not null check (soort in ('inmeting','montage')),
  start_op          timestamptz not null,
  eind_op           timestamptz not null,
  status            text not null default 'voorlopig'
                    check (status in ('voorlopig','bevestigd','geannuleerd')),
  vervalt_op        timestamptz,                        -- voorlopige reservering: +24u
  google_event_id   text,
  aangemaakt_op     timestamptz not null default now(),
  check (eind_op > start_op)
);

create index on afspraken (monteur_id, start_op);

-- ------------------------------------------------------------ reviewqueue

create table review_items (
  id                uuid primary key default gen_random_uuid(),
  monteur_id        uuid not null references monteurs(id) on delete cascade,
  lead_id           uuid not null references leads(id) on delete cascade,
  reden             text not null,   -- lage_confidence | emotie | prijsvraag | klacht | buiten_regels
  samenvatting      text not null,
  voorgesteld_antwoord text,
  status            text not null default 'open'
                    check (status in ('open','afgehandeld','genegeerd')),
  aangemaakt_op     timestamptz not null default now(),
  afgehandeld_op    timestamptz
);

create index on review_items (monteur_id, status, aangemaakt_op);

-- ---------------------------------------------------------------------- RLS

alter table monteurs          enable row level security;
alter table monteur_profielen enable row level security;
alter table kanalen           enable row level security;
alter table leads             enable row level security;
alter table berichten         enable row level security;
alter table afspraken         enable row level security;
alter table review_items      enable row level security;

-- De monteur ziet alleen zijn eigen rijen. auth.uid() = monteurs.id.
create policy eigen_monteur on monteurs
  for all using (id = auth.uid());

create policy eigen_profiel on monteur_profielen
  for all using (monteur_id = auth.uid());

create policy eigen_kanalen on kanalen
  for all using (monteur_id = auth.uid());

create policy eigen_leads on leads
  for all using (monteur_id = auth.uid());

create policy eigen_afspraken on afspraken
  for all using (monteur_id = auth.uid());

create policy eigen_review on review_items
  for all using (monteur_id = auth.uid());

create policy eigen_berichten on berichten
  for all using (
    exists (select 1 from leads l where l.id = berichten.lead_id and l.monteur_id = auth.uid())
  );

-- De webhook draait met de service role en omzeilt RLS bewust:
-- daar wordt monteur_id altijd expliciet afgeleid uit het kanaal.
