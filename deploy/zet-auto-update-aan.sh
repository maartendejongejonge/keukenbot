#!/usr/bin/env bash
#
# EENMALIG op de server, als je eigen gebruiker:
#   cd ~/keukenbot && git pull && sudo bash deploy/zet-auto-update-aan.sh
#
# Daarna rolt de server elke nieuwe versie op GitHub (main) zelf uit,
# ook de verbeteringen van de avondcheck. Uitzetten:
#   sudo systemctl disable --now pico-auto-update.timer

set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Draai met sudo."; exit 1; }
HIER="$(cd "$(dirname "$0")" && pwd)"

# De service draait het script uit /opt/keukenbot; zorg dat die versie er staat.
bash "$HIER/installeer-app.sh" >/dev/null
cp "$HIER/pico-auto-update.service" "$HIER/pico-auto-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pico-auto-update.timer
echo "Automatisch bijwerken staat aan."
echo "Logboek:   journalctl -t pico-auto -n 50"
echo "Uitzetten: sudo systemctl disable --now pico-auto-update.timer"
