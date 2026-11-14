#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs

lan_ip=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || true)
host="$(scutil --get LocalHostName).local"
names=(localhost 127.0.0.1 ::1 recipe-monster.orb.local "$host")
[ -n "$lan_ip" ] && names+=("$lan_ip")

mkcert -cert-file certs/cert.pem -key-file certs/key.pem "${names[@]}"
cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem
chmod 644 certs/cert.pem certs/key.pem certs/rootCA.pem

echo
echo "Certificate covers: ${names[*]}"
echo "AirDrop certs/rootCA.pem to your phone and trust it."
echo "Open:  https://localhost:3443"
echo "Run:   PUBLIC_URL=https://${lan_ip:-$host}:3443 docker compose up -d --build"
