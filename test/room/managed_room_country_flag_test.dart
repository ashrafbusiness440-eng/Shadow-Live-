import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/widgets/managed_room_country_flag.dart';

void main() {
  test('flags correspond only to explicitly recognized country names', () {
    expect(managedRoomCountryFlag('الإمارات العربية المتحدة'), '🇦🇪');
    expect(managedRoomCountryFlag('UAE'), '🇦🇪');
    expect(managedRoomCountryFlag('سوريا'), '🇸🇾');
    expect(managedRoomCountryFlag('Lebanon'), '🇱🇧');
    expect(managedRoomCountryFlag('Unknown'), '');
    expect(managedRoomCountryFlag('Dubai'), '');
    expect(managedRoomCountryFlag('California'), '');
    expect(managedRoomCountryFlag(''), '');
  });
}
