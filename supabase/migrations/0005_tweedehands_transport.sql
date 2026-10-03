-- 0005 — tweedehands keukens, transportprijzen per monteur
-- Idempotent: veilig om opnieuw te draaien.
--
-- Tweedehands keukens hebben geen onderdelenlijst; de bot werkt met foto's.
-- Transport mag de bot noemen als de monteur het in zijn profiel zet.
-- Rotterdam Keukenmontage: € 200 autohuur + € 85 per uur (03-10-2026).
-- Verticaal transport loopt via een andere partij en wordt niet geprijsd.

alter table monteur_profielen
  add column if not exists transport jsonb;   -- {"autohuur":200,"uurtarief":85}

alter table leads
  add column if not exists tweedehands boolean;

update monteur_profielen p
set transport = '{"autohuur": 200, "uurtarief": 85}'::jsonb
from monteurs m
where m.id = p.monteur_id
  and m.bedrijfsnaam = 'Rotterdam Keukenmontage';
