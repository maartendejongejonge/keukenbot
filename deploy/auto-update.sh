#!/usr/bin/env bash
#
# Pico werkt zichzelf bij (02-11-2026). Draait als root via pico-auto-update.timer,
# elke 5 minuten. Staat er op GitHub een nieuwere main, dan:
#   1. nieuwe database-migratie erin?  → NIET uitrollen, alleen in het logboek;
#   2. bouwen en installeren met deploy/installeer-app.sh (van de NIEUWE versie);
#   3. 90 seconden kijken of de bot blijft draaien;
#   4. zo niet: terug naar de vorige versie en die commit voortaan overslaan.
#
# Logboek:  journalctl -t pico-auto -n 50
# Uitzetten: sudo systemctl disable --now pico-auto-update.timer

set -uo pipefail

MAP=/opt/keukenbot
GEBRUIKER=keukenbot
STAAT=/var/lib/pico-auto
alsbot() { sudo -u "$GEBRUIKER" -H bash -c "cd $MAP && $*"; }
log() { logger -t pico-auto "$*"; echo "$*"; }

install -d -m 700 "$STAAT"
alsbot "git fetch -q origin main" || { log "fetch mislukt; volgende keer opnieuw"; exit 0; }

OUD=$(alsbot "git rev-parse HEAD")
NIEUW=$(alsbot "git rev-parse origin/main")
[ "$OUD" = "$NIEUW" ] && exit 0
[ "$(cat "$STAAT/overslaan" 2>/dev/null)" = "$NIEUW" ] && exit 0

if [ -n "$(alsbot "git diff --name-only $OUD $NIEUW -- supabase/migrations")" ]; then
  if [ "$(cat "$STAAT/migratie-gemeld" 2>/dev/null)" != "$NIEUW" ]; then
    log "NIET uitgerold: $NIEUW bevat een database-migratie. Eerst in Supabase draaien, dan: sudo bash ~/keukenbot/deploy/installeer-app.sh"
    echo "$NIEUW" > "$STAAT/migratie-gemeld"
  fi
  exit 0
fi

log "uitrollen ${OUD:0:7} → ${NIEUW:0:7}: $(alsbot "git log -1 --format=%s $NIEUW")"

# Het installatiescript van de nieuwe versie, los van de map die het zelf omzet.
alsbot "git show $NIEUW:deploy/installeer-app.sh" > /run/pico-installeer.sh

terug() {
  log "MISLUKT ($1): terug naar ${OUD:0:7}; ${NIEUW:0:7} wordt overgeslagen"
  echo "$NIEUW" > "$STAAT/overslaan"
  alsbot "git checkout -q -f $OUD && npm install --no-audit --no-fund --loglevel=error && npm run build --silent"
  systemctl restart keukenbot
}

if ! bash /run/pico-installeer.sh > /var/log/pico-auto-laatste.log 2>&1; then
  terug "bouwen/installeren, zie /var/log/pico-auto-laatste.log"
  exit 1
fi

systemctl restart keukenbot
sleep 90
HERSTARTS=$(systemctl show -p NRestarts --value keukenbot)
if ! systemctl is-active --quiet keukenbot || [ "${HERSTARTS:-0}" -gt 0 ]; then
  terug "bot draait niet stabiel (herstarts: ${HERSTARTS:-?})"
  exit 1
fi

log "gelukt: ${NIEUW:0:7} draait"
