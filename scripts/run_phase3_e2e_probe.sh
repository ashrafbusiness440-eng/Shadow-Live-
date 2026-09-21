#!/usr/bin/env bash
set -euo pipefail

python3 -m http.server 4173 --directory build/web >/tmp/shadow-live-e2e-web.log 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4173 >/dev/null; then
    break
  fi
  sleep 1
done

FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
GCLOUD_PROJECT=shadow-live \
PHASE3_BASE_URL=http://127.0.0.1:4173 \
node scripts/phase3_e2e_probe.mjs
