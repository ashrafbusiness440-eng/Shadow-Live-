# Phase 4 final verification deploy
set -e
rm -rf /tmp/shadow-live-app
cp web/index.html /tmp/control-index.html
cp web/manifest.json /tmp/control-manifest.json
cp scripts/app_index.html web/index.html
cp scripts/app_manifest.json web/manifest.json
/tmp/flutter/bin/flutter build web --release --target lib/main.dart --base-href /app/
mv build/web /tmp/shadow-live-app
cp /tmp/control-index.html web/index.html
cp /tmp/control-manifest.json web/manifest.json
/tmp/flutter/bin/flutter build web --release --target lib/main_control.dart
mkdir -p build/web/app
cp -R /tmp/shadow-live-app/. build/web/app/
