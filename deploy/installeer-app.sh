#!/usr/bin/env bash
#
# Zet de keukenbot-code in /opt/keukenbot, bouwt hem en installeert de
# service. Draai NA setup-vps.sh, als je eigen gebruiker (niet keukenbot):
#
#   sudo bash deploy/installeer-app.sh
#
# Ook om bij te werken na een wijziging op GitHub: gewoon opnieuw draaien.
# De .env en de WhatsApp-sessie (auth/) blijven staan.

set -euo pipefail

REPO="https://github.com/maartendejongejonge/keukenbot.git"
MAP="/opt/keukenbot"
GEBRUIKER="keukenbot"
alsbot() { sudo -u "$GEBRUIKER" -H bash -c "cd $MAP && $*"; }

[ "$(id -u)" -eq 0 ] || { echo "Draai met sudo."; exit 1; }
id "$GEBRUIKER" &>/dev/null || { echo "Gebruiker $GEBRUIKER bestaat niet. Eerst setup-vps.sh."; exit 1; }
command -v git >/dev/null || apt-get install -y -qq git

echo ">> Code ophalen"
install -d -m 750 -o "$GEBRUIKER" -g "$GEBRUIKER" "$MAP"
if [ ! -d "$MAP/.git" ]; then
  # De map bestaat al (met auth/ en misschien .env), dus geen gewone clone.
  alsbot "git init -q && git remote add origin $REPO"
fi
alsbot "git fetch -q origin main && git checkout -q -f -B main origin/main"
echo "   versie: $(alsbot 'git log -1 --format="%h %s"')"

echo ">> Pakketten installeren en bouwen"
alsbot "npm install --no-audit --no-fund --loglevel=error"
alsbot "npm run build --silent"

echo ">> .env"
if [ ! -f "$MAP/.env" ]; then
  install -m 600 -o "$GEBRUIKER" -g "$GEBRUIKER" "$MAP/deploy/env.voorbeeld" "$MAP/.env"
  echo "   Nieuw aangemaakt uit het voorbeeld. Vul hem in met:"
  echo "     sudo nano $MAP/.env"
else
  chown "$GEBRUIKER:$GEBRUIKER" "$MAP/.env"
  chmod 600 "$MAP/.env"
  echo "   bestaat al, niet aangeraakt"
fi
install -d -m 700 -o "$GEBRUIKER" -g "$GEBRUIKER" "$MAP/auth"

echo ">> Service installeren"
cp "$MAP/deploy/keukenbot.service" /etc/systemd/system/keukenbot.service
systemctl daemon-reload
systemctl enable keukenbot >/dev/null 2>&1
if systemctl is-active --quiet keukenbot; then
  systemctl restart keukenbot
  echo "   draaide al: herstart met de nieuwe versie"
else
  echo "   geïnstalleerd, nog niet gestart"
fi

cat <<EOF

Klaar. Volgende stappen:

  1. Controleer de koppelingen:
       sudo -u $GEBRUIKER -H bash -c 'cd $MAP && npm run check'

  2. Als alles groen is, start de bot en kijk mee:
       sudo systemctl start keukenbot
       journalctl -u keukenbot -f

     De eerste keer verschijnt daar een KOPPELCODE. Op de telefoon met het
     wegwerpnummer: WhatsApp → Gekoppelde apparaten → Apparaat koppelen →
     Koppelen met telefoonnummer, en typ de code over.

EOF
