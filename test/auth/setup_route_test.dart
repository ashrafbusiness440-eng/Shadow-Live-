import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/auth/setup_route.dart';

void main() {
  group('setupDestination', () {
    test('routes missing profile to profile setup', () {
      expect(setupDestination(null), '/profile-setup');
      expect(setupDestination(const {}), '/profile-setup');
    });

    test('setupComplete always routes to main', () {
      expect(setupDestination({'setupComplete': true, 'setupStep': 'ready'}), '/main');
      expect(setupDestination({'setupComplete': true, 'setupStep': 'profile'}), '/main');
    });

    test('supports both complete spellings', () {
      expect(setupDestination({'setupComplete': false, 'setupStep': 'complete'}), '/main');
      expect(setupDestination({'setupComplete': false, 'setupStep': 'completed'}), '/main');
    });

    test('resumes each incomplete setup step', () {
      expect(setupDestination({'setupStep': 'profile'}), '/profile-setup');
      expect(setupDestination({'setupStep': 'success'}), '/account-success');
      expect(setupDestination({'setupStep': 'linking'}), '/account-linking');
      expect(setupDestination({'setupStep': 'ready'}), '/account-ready');
    });

    test('covers the complete Phase 3 account journey in order', () {
      final destinations = [
        setupDestination({'setupStep': 'profile', 'setupComplete': false}),
        setupDestination({'setupStep': 'success', 'setupComplete': false}),
        setupDestination({'setupStep': 'linking', 'setupComplete': false}),
        setupDestination({'setupStep': 'ready', 'setupComplete': false}),
        setupDestination({'setupStep': 'complete', 'setupComplete': true}),
      ];

      expect(
        destinations,
        [
          '/profile-setup',
          '/account-success',
          '/account-linking',
          '/account-ready',
          '/main',
        ],
      );
    });

    test('login resume is safe for malformed setupStep values', () {
      expect(
        setupDestination({'setupStep': 123, 'setupComplete': false}),
        '/profile-setup',
      );
    });
  });
}
