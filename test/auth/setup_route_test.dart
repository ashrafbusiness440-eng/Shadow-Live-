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
  });
}
