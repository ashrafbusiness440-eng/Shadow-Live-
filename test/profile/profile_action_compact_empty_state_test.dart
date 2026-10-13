import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('relationship CTA is calm and bounded without changing permission flow', () {
    final profile = File('lib/features/profile/screens/public_profile_screen.dart')
        .readAsStringSync();
    expect(profile.contains('if (!isSelf)'), isTrue);
    expect(profile.contains('constraints: const BoxConstraints(maxWidth: 300)'), isTrue);
    expect(profile.contains('minimumSize: const Size(0, 44)'), isTrue);
    expect(profile.contains("label: const Text('طلب علاقة')"), isTrue);
    expect(profile.contains('await _requestRelationship(name);'), isTrue);
    expect(profile.contains('if (_guest) {'), isTrue);
    expect(profile.contains('onPressed: _sendingRelationship'), isTrue);
    expect(profile.contains('minimumSize: const Size.fromHeight(46)'), isFalse);
  });

  test('public profile shows a meaningful mood placeholder and preserves bio', () {
    final profile = File('lib/features/profile/screens/public_profile_screen.dart')
        .readAsStringSync();
    expect(profile.contains("mood.isEmpty ? 'لم يضف حالة حتى الآن' : mood"), isTrue);
    expect(profile.contains('Icons.sentiment_neutral_outlined'), isTrue);
    expect(profile.contains("bio.isEmpty ? 'لا توجد نبذة بعد.' : bio"), isTrue);
    expect(profile.contains('Timer.periodic'), isFalse);
  });

  test('own profile offers its real edit route only for missing mood', () {
    final profile = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    expect(profile.contains('if (mood.isNotEmpty) ...['), isTrue);
    expect(profile.contains('] else ...['), isTrue);
    expect(profile.contains("'لم تضف حالة بعد'"), isTrue);
    expect(profile.contains('onPressed: _openingEdit ? null : _edit'), isTrue);
    expect(profile.contains("child: const Text('إضافة حالة')"), isTrue);
    expect(profile.contains('Navigator.of(context).pushNamed(AppRoutes.editProfile)'), isTrue);
    expect(profile.contains('Timer.periodic'), isFalse);
  });
}
