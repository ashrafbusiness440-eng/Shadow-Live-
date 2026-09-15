import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/auth/setup_route.dart';

void main() {
  group('setupDestination', () {
    test('new phone account starts profile setup', () {
      expect(
        setupDestination({
          'setupStep': 'profile',
          'setupComplete': false,
        }),
        '/profile-setup',
      );
    });

    test('missing setup data safely starts profile setup', () {
      expect(setupDestination(null), '/profile-setup');
      expect(setupDestination(const {}), '/profile-setup');
    });

    test('resumes every saved setup step', () {
      expect(
        setupDestination({'setupStep': 'success'}),
        '/account-success',
      );
      expect(
        setupDestination({'setupStep': 'linking'}),
        '/account-linking',
      );
      expect(
        setupDestination({'setupStep': 'ready'}),
        '/account-ready',
      );
    });

    test('only completed setup enters the main app', () {
      expect(
        setupDestination({'setupStep': 'complete'}),
        '/main',
      );
      expect(
        setupDestination({
          'setupStep': 'profile',
          'setupComplete': true,
        }),
        '/main',
      );
    });

    test('unknown setup step falls back to profile setup', () {
      expect(
        setupDestination({'setupStep': 'unknown'}),
        '/profile-setup',
      );
    });
  });
}
