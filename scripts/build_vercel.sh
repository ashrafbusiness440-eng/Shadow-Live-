set -e
rm -rf /tmp/shadow-live-app
/tmp/flutter/bin/flutter build web --release --target lib/main.dart --base-href /app/
mv build/web /tmp/shadow-live-app
/tmp/flutter/bin/flutter build web --release --target lib/main_control.dart
mkdir -p build/web/app
cp -R /tmp/shadow-live-app/. build/web/app/
