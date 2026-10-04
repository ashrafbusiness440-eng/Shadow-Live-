import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_profile_visit.dart';
import 'package:voice_chat_room/admin/control_special_id.dart';
import 'package:voice_chat_room/admin/control_vip.dart';

void main() {
  test('VIP1-10 entitlement thresholds match the approved migration map', () {
    expect(VipEntitlementPolicy.viewProfileVisits(1), isTrue);
    expect(VipEntitlementPolicy.chatBubble(2), isTrue);
    expect(VipEntitlementPolicy.hideLevels(3), isTrue);
    expect(VipEntitlementPolicy.animatedProfileAvatar(4), isTrue);
    expect(VipEntitlementPolicy.hideOnline(5), isTrue);
    expect(VipEntitlementPolicy.kickProtection(6), isTrue);
    expect(VipEntitlementPolicy.silentRoomEntry(7), isTrue);
    expect(VipEntitlementPolicy.entryStrip(8), isTrue);
    expect(VipEntitlementPolicy.hideVisitIdentity(9), isTrue);
    expect(VipEntitlementPolicy.muteProtection(10), isTrue);
    expect(() => VipEntitlementPolicy.validateLevel(11), throwsArgumentError);
  });

  test('Fancy ID is numeric and its range follows effective VIP level', () {
    expect(SpecialIdPolicy.validForVip('123456', 3), isTrue);
    expect(SpecialIdPolicy.validForVip('12345', 3), isFalse);
    expect(SpecialIdPolicy.validForVip('1234', 8), isTrue);
    expect(SpecialIdPolicy.validForVip('123', 9), isFalse);
    expect(SpecialIdPolicy.validForVip('123', 10), isTrue);
    expect(SpecialIdPolicy.validForVip('SHADOW7', 10), isFalse);
  });

  test('profile visits unlock at VIP1 and hidden visits start at VIP9', () {
    expect(ProfileVisitPolicy.canViewHistory(viewerVipLevel: 0), isFalse);
    expect(ProfileVisitPolicy.canViewHistory(viewerVipLevel: 1), isTrue);
    expect(ProfileVisitPolicy.recordVisibleVisit(visitorVipLevel: 8), isTrue);
    expect(ProfileVisitPolicy.recordVisibleVisit(visitorVipLevel: 9), isFalse);
    expect(ProfileVisitPolicy.showIdentity(visitorVipLevel: 9), isFalse);
  });

  test('legacy client VIP mutation is blocked and new fields are protected', () {
    final bloc = File('lib/features/user/bloc/user_bloc.dart').readAsStringSync();
    final rules = File('firestore.rules').readAsStringSync();

    expect(
      bloc.contains(
        'VIP state is server-authoritative and cannot be changed by the client',
      ),
      isTrue,
    );
    expect(bloc.contains("'vipLevel': event.vipLevel"), isFalse);
    expect(rules.contains("'earnedVipLevel'"), isTrue);
    expect(rules.contains("'effectiveVipLevel'"), isTrue);
    expect(rules.contains("'adminGrantVipLevel'"), isTrue);
    expect(rules.contains("'vipGrowthPoints'"), isTrue);
    expect(rules.contains("'vipExpiresAt'"), isTrue);
  });
}
