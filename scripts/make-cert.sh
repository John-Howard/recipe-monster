#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs
mkcert -install

HOST="${HOST:-recipe-monster.local}"

lan_ip=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || true)
host="$(scutil --get LocalHostName).local"
names=("$HOST" localhost 127.0.0.1 ::1 "$host")
[ -n "$lan_ip" ] && names+=("$lan_ip")

mkcert -cert-file certs/cert.pem -key-file certs/key.pem "${names[@]}"
cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem
chmod 644 certs/cert.pem certs/rootCA.pem
chmod 600 certs/key.pem

echo
echo "Certificate covers: ${names[*]}"
echo "AirDrop certs/rootCA.pem to your phone and trust it."
echo "Open:  https://$HOST"
echo "Run:   make up"
grep -q "$HOST" /etc/hosts || echo "Add '127.0.0.1 $HOST' and '::1 $HOST' to /etc/hosts"
