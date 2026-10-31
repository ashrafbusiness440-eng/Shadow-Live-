import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/room_action_service.dart';

void main() {
  test('managed room response requires a valid role and room identity', () {
    const base = <String, dynamic>{
      'roomId': 'personal_owner-1',
      'ownerUid': 'owner-1',
      'name': 'غرفة الصوت',
      'ownerName': 'المالك',
    };
    final owned = ManagedRoomEntry.fromJson({...base, 'relation': 'owner'});
    final moderated = ManagedRoomEntry.fromJson({...base, 'relation': 'moderator'});
    expect(owned.isOwner, isTrue);
    expect(moderated.isModerator, isTrue);
    expect(owned.room.name, 'غرفة الصوت');
    final official = ManagedRoomEntry.fromJson(const {
      'roomId': 'official-vip',
      'ownerUid': '',
      'hostUid': 'official-host',
      'roomType': 'official',
      'relation': 'moderator',
    });
    expect(official.isModerator, isTrue);
    expect(official.room.toNavigationArguments()['hostId'], 'official-host');
    expect(() => PersonalRoomInfo.fromJson(const {
      'roomId': 'official-vip',
      'ownerUid': '',
    }), throwsFormatException);
    expect(() => ManagedRoomEntry.fromJson({...base, 'relation': 'visitor'}),
        throwsFormatException);
    expect(() => ManagedRoomEntry.fromJson({'relation': 'owner'}),
        throwsFormatException);
  });

  test('shared room cards reuse server read and existing password admission', () {
    final panel = File(
      'lib/features/room/widgets/managed_rooms_panel.dart',
    ).readAsStringSync();
    final service = File(
      'lib/features/room/services/room_action_service.dart',
    ).readAsStringSync();
    final rooms = File('lib/screens/room/room_list_screen.dart')
        .readAsStringSync();
    final profile = File(
      'lib/features/profile/widgets/profile_personal_room_tab.dart',
    ).readAsStringSync();

    expect(service, contains("'action': 'roomManagedList'"));
    expect(panel, contains('loadManagedRooms()'));
    expect(panel, contains('showDiscoveryRoomPasswordPrompt('));
    expect(panel, contains('room.toNavigationArguments()'));
    expect(panel, contains('AppRoutes.voiceChatRoom'));
    expect(panel, contains('if (_entering) return;'));
    expect(panel, contains('FirebaseAuth.instance.currentUser?.uid != user.uid'));
    expect(panel, contains('if (widget.sheetMode) Navigator.of(context).pop();'));
    expect(panel, isNot(contains('Timer.periodic')));
    expect(rooms, contains('Future<void> _showManagedRooms() async'));
    expect(rooms, contains('if (_openingPersonalRoom || _managedRoomsSheetOpen) return;'));
    expect(rooms, contains('await showModalBottomSheet<void>('));
    expect(rooms, contains('_openingPersonalRoom ? null : _showManagedRooms'));
    expect(profile, contains('ManagedRoomsPanel('));
    expect(profile, contains('غرفي والإشراف'));
  });
}
