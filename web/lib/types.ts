/** Spiegelt de tabellen in supabase/migrations. Alleen wat de webapp gebruikt. */

export interface Monteur {
  id: string;
  bedrijfsnaam: string;
  contactnaam: string;
  email: string;
  telefoon: string | null;
  abonnement: 'basis' | 'plus' | 'ploeg';
  actief: boolean;
  aangemaakt_op: string;
  auth_user_id: string | null;
  uitgenodigd_op: string | null;
}

/** Zie src/prijs.ts → Uurnormen. Uren per post. */
export interface Uurnormen {
  kast_bouwpakket: { onder: number; hang: number; hoog: number };
  kast_voorgemonteerd: { onder: number; hang: number; hoog: number };
  grens_kasten: number;
  stellen_ophangen: { klein: number; groot: number };
  fronten_plinten: { klein: number; groot: number };
  opruimen: { klein: number; groot: number };
  werkblad: number;
  werkblad_hoek_extra: number;
  kitwerk?: number;
  kitwerk_hoek_extra?: number;
  eiland_extra: number;
  water_basis: number;
  waterpunt: number;
  apparaat: number;
  kookplaat: number;
  verdieping_zonder_lift: number;
  uren_per_dag: number;
  bandbreedte_pct: number;
}

export interface Klusjes {
  uurtarief: number;
  minimum_uren: number;
  incl_btw?: boolean;
  werkgebied_pc4?: number[];
}

export interface Transport {
  autohuur: number;
  uurtarief: number;
}

export interface Profiel {
  monteur_id: string;
  werkgebied_pc4: number[];
  max_reistijd_min: number;
  werkdagen: number[];
  werkdag_start: string;
  werkdag_eind: string;
  buffer_dagdelen: number;
  inmeting_duur_min: number;
  montage_duur_dagdelen: number;
  profiel_ingevuld: boolean;
  toon: string;
  weigert: string[];
  google_agenda_id: string | null;
  whatsapp_nummer: string | null;
  hersteldag_na_meerdaagse: boolean;
  vertrek_postcode: string | null;
  km_tarief: number;
  uurtarief: number | null;
  reisuur_percentage: number;
  gratis_pc4: number[];
  hotel_richtprijs: number;
  prijzen_tonen: boolean;
  uurnormen: Uurnormen | null;
  aanspreeknaam: string | null;
  telefoon_voor_klanten: boolean;
  advies: string[];
  klusjes: Klusjes | null;
  transport: Transport | null;
  google_gekoppeld_op: string | null;
  google_email: string | null;
}

export type LeadStatus =
  | 'nieuw' | 'kwalificeren' | 'gekwalificeerd' | 'afgewezen' | 'ingepland' | 'overgedragen' | 'verlopen';

export interface Lead {
  id: string;
  klant_naam: string | null;
  klant_telefoon: string | null;
  status: LeadStatus;
  pc4: number | null;
  plaats: string | null;
  type_klus: string | null;
  leverancier: string | null;
  omvang: string | null;
  installatiewerk: string[] | null;
  keuken_geleverd: boolean | null;
  gewenste_periode: string | null;
  afwijsreden: string | null;
  laatste_bericht_op: string | null;
  aangemaakt_op: string;
  afstand_km: number | null;
  reiskosten: number | null;
  verdieping: number | null;
  lift: boolean | null;
  leverdatum: string | null;
  werkblad_door: string | null;
  prijs_min: number | null;
  prijs_max: number | null;
  prijs_incl_btw: boolean | null;
  dagen_min: number | null;
  dagen_max: number | null;
  klusjes: string | null;
  tweedehands: boolean | null;
}

export interface Bericht {
  id: string;
  richting: 'in' | 'uit';
  afzender: 'klant' | 'bot' | 'monteur';
  tekst: string;
  verzonden_op: string;
}

export interface Afspraak {
  id: string;
  lead_id: string;
  soort: 'inmeting' | 'montage' | 'klusje';
  start_op: string;
  eind_op: string;
  status: 'voorlopig' | 'bevestigd' | 'geannuleerd';
}

export interface Seintje {
  id: string;
  lead_id: string;
  reden: string;
  samenvatting: string;
  voorgesteld_antwoord: string | null;
  status: 'open' | 'afgehandeld' | 'genegeerd';
  aangemaakt_op: string;
}
