import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('worker dispatch exposes relationships endpoint', () {
    final worker = File('cloudflare-worker/src/index.js').readAsStringSync();
    expect(worker.contains('"/api/relationships"'), isTrue);
    expect(worker.contains('relationships(request, env)'), isTrue);
  });

  test('relationships stay API-driven and off hot paths', () {
    final service = File(
      'lib/features/relationships/services/relationship_service.dart',
    ).readAsStringSync();
    final page = File(
      'lib/features/relationships/screens/relationships_page.dart',
    ).readAsStringSync();
    final publicProfile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final notifications = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();

    expect(service.contains('/relationships'), isTrue);
    expect(service.contains('route_not_found'), isTrue);
    expect(service.contains('.snapshots()'), isFalse);
    expect(page.contains('.snapshots()'), isFalse);
    expect(page.contains('Timer.periodic'), isFalse);
    expect(publicProfile.contains('طلب علاقة'), isTrue);
    expect(notifications.contains('_openRelationshipRequest'), isTrue);
  });

  test('my profile links to relationships without changing main tabs', () {
    final profile = File(
      'lib/features/user/screens/profile_screen.dart',
    ).readAsStringSync();
    final shell = File(
      'lib/features/main/screens/main_shell_screen.dart',
    ).readAsStringSync();

    expect(profile.contains("'العلاقات'"), isTrue);
    expect(profile.contains('RelationshipsPage'), isTrue);
    expect(shell.contains("label: 'يومياتي'"), isTrue);
    expect(shell.contains("label: 'صوت'"), isFalse);
  });

  test('shadow control exposes relationship types only through system managers', () {
    final control = File('lib/main_control.dart').readAsStringSync();
    final page = File(
      'lib/admin/control_relationship_types_page.dart',
    ).readAsStringSync();

    expect(control.contains('canManageSystem'), isTrue);
    expect(control.contains("'العلاقات / CP'"), isTrue);
    expect(page.contains("'setTypes'"), isTrue);
    expect(page.contains('لا يمكن حذف نوع موجود'), isTrue);
  });
}
