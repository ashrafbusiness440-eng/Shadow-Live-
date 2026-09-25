import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Shadow Control never uses the default Firebase Auth instance', () {
    final files = <File>[
      File('lib/main_control.dart'),
      ...Directory('lib/admin')
          .listSync(recursive: true)
          .whereType<File>()
          .where((file) => file.path.endsWith('.dart')),
    ];

    final defaultAuth = RegExp(r'FirebaseAuth\.instance(?!For)');
    final offenders = <String>[];

    for (final file in files) {
      final source = file.readAsStringSync();
      if (defaultAuth.hasMatch(source)) {
        offenders.add(file.path);
      }
    }

    expect(
      offenders,
      isEmpty,
      reason:
          'Shadow Control must use controlAuth only. Default Firebase Auth '
          'shares the Shadow Live application session and breaks account '
          'isolation. Offenders: ${offenders.join(', ')}',
    );
  });

  test('Shadow Control keeps its named app and web session persistence', () {
    final source =
        File('lib/admin/control_firebase.dart').readAsStringSync();

    expect(source, contains("name: 'shadow-control'"));
    expect(source, contains('Persistence.SESSION'));
    expect(source, contains('FirebaseAuth.instanceFor(app: app)'));
  });
}
