import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('live PWA boot does not erase service workers or caches at startup', () {
    final template = File('scripts/app_index.html').readAsStringSync();
    expect(template, contains(r'<base href="$FLUTTER_BASE_HREF">'));
    expect(template, contains('flutter_bootstrap.js?v=20261002-main-shell-fix'));
    expect(template, isNot(contains('.getRegistrations()')));
    expect(template, isNot(contains('.unregister()')));
    expect(template, isNot(contains('caches.keys()')));
    expect(template, isNot(contains('caches.delete(')));
    expect(template, isNot(contains("script.async = false")));
  });

  test('deployment continues versioning both app and control bundles', () {
    final workflow = File(
      '.github/workflows/deploy-shadow-control-pages.yml',
    ).readAsStringSync();
    expect(workflow, contains('cp scripts/app_index.html web/index.html'));
    expect(workflow, contains('flutter build web --release --pwa-strategy=none'));
    expect(workflow, contains('html.replace(old, "v=" + sha)'));
    expect(workflow, contains("'main.dart.js?v=' + sha"));
    expect(workflow, contains('site/live/'));
    expect(workflow, contains('/Shadow-Live-/live/'));
    expect(workflow, contains('/Shadow-Live-/control/'));
    // This fix must not confuse the two isolated PWAs.
    final control = File('scripts/control_index.html').readAsStringSync();
    expect(control, contains('Shadow Control'));
  });
}
