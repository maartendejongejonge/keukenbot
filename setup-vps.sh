#!/usr/bin/env bash
#
# Zet een verse Ubuntu VPS klaar voor de keukenbot.
# Getest op 24.04 en 26.04 LTS. Draai als root, één keer:
#
#   nano setup-vps.sh     # plakken, Ctrl+O, Enter, Ctrl+X
#   bash setup-vps.sh
#
# Na afloop log je in als `keukenbot`, niet meer als root.

set -euo pipefail

GEBRUIKER="keukenbot"
NODE_MINIMAAL=20      # Baileys vraagt Node 20 of hoger
SWAP_GB=2

. /etc/os-release
echo ">> Gevonden: $PRETTY_NAME"

echo ">> Systeem bijwerken"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl ca-certificates gnupg

echo ">> Automatische beveiligingsupdates"
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# ---------------------------------------------------------------- swap
# 1 GB RAM is krap voor Node met Baileys. Zonder swap schiet de kernel het
# proces stilletjes af bij een piek, en dan staat de bot uit zonder melding.
if ! swapon --show | grep -q .; then
  echo ">> Swapbestand van ${SWAP_GB} GB aanmaken"
  fallocate -l "${SWAP_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB*1024))
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Laag houden: swap is het vangnet, niet het werkgeheugen.
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  echo ">> Swap staat al aan, overgeslagen"
fi

# ------------------------------------------------------------ gebruiker
echo ">> Gebruiker $GEBRUIKER aanmaken"
if ! id "$GEBRUIKER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$GEBRUIKER"
  usermod -aG sudo "$GEBRUIKER"
fi

# Neem de SSH-sleutel over waarmee je nu binnenkomt, zodat je jezelf
# niet buitensluit als root straks dicht gaat.
if [ -s /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o "$GEBRUIKER" -g "$GEBRUIKER" "/home/$GEBRUIKER/.ssh"
  install -m 600 -o "$GEBRUIKER" -g "$GEBRUIKER" \
    /root/.ssh/authorized_keys "/home/$GEBRUIKER/.ssh/authorized_keys"
  echo "   sleutel gekopieerd naar $GEBRUIKER"
else
  echo "   LET OP: geen SSH-sleutel bij root gevonden."
  echo "   Je logt nu met een wachtwoord in. Zet eerst een sleutel neer"
  echo "   voordat je onderaan PasswordAuthentication uitzet."
fi

# -------------------------------------------------------------- firewall
echo ">> Firewall: alleen SSH open"
apt-get install -y -qq ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
ufw --force enable
# Poort 443 blijft dicht: de bot maakt zelf verbinding naar buiten, er hoeft
# niets binnen te komen. Pas openzetten bij de Cloud API-webhook.

echo ">> fail2ban tegen inlogpogingen"
apt-get install -y -qq fail2ban
systemctl enable --now fail2ban

# ------------------------------------------------------------------ node
# Drie routes, in volgorde van voorkeur. NodeSource heeft niet altijd meteen
# een pakket voor een nieuwe Ubuntu-versie; dan pakken we wat Ubuntu zelf
# meelevert, en als dat te oud is snap.
echo ">> Node.js installeren"

node_versie() { node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0; }

if curl -fsSL "https://deb.nodesource.com/setup_22.x" -o /tmp/nodesource.sh 2>/dev/null \
   && bash /tmp/nodesource.sh >/dev/null 2>&1 \
   && apt-get install -y -qq nodejs 2>/dev/null; then
  echo "   via NodeSource"
else
  echo "   NodeSource lukte niet (waarschijnlijk nog geen pakket voor ${VERSION_ID}), val terug op Ubuntu"
  rm -f /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs npm || true
fi

if [ "$(node_versie)" -lt "$NODE_MINIMAAL" ]; then
  echo "   te oud ($(node --version 2>/dev/null || echo geen)), installeer via snap"
  apt-get remove -y -qq nodejs npm || true
  snap install node --classic --channel=22
  ln -sf /snap/bin/node /usr/bin/node
  ln -sf /snap/bin/npm /usr/bin/npm
fi

echo "   Node: $(node --version), npm: $(npm --version)"

# --------------------------------------------------------------- overig
echo ">> Tijdzone op Amsterdam (de planner rekent in lokale tijd)"
timedatectl set-timezone Europe/Amsterdam

echo ">> Projectmap"
install -d -m 750 -o "$GEBRUIKER" -g "$GEBRUIKER" /opt/keukenbot
# De WhatsApp-sessie is de sleutel tot het account: alleen voor de service.
install -d -m 700 -o "$GEBRUIKER" -g "$GEBRUIKER" /opt/keukenbot/auth

cat <<'EOF'

Klaar. Controleer even:

  free -h            # je moet nu 2 GB swap zien
  node --version     # moet v20 of hoger zijn
  ufw status         # alleen 22/tcp

Daarna twee dingen met de hand:

1. Test in een TWEEDE terminal of je binnenkomt als de nieuwe gebruiker:
     ssh keukenbot@149.210.205.238
   Pas als dat lukt, root-login uitzetten:
     sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
     sudo systemctl restart ssh
   En als je een SSH-sleutel gebruikt, ook:
     sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
     sudo systemctl restart ssh

2. Zet je omgevingsvariabelen in /opt/keukenbot/.env (chmod 600):
     SUPABASE_URL=
     SUPABASE_SERVICE_ROLE_KEY=
     ANTHROPIC_API_KEY=
     WHATSAPP_NUMMER=31620236793

EOF
