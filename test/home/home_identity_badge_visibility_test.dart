import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';

void main() {
  const activeVip = <String, dynamic>{
    'effectiveVipLevel': 4,
    'vipExpiresAt': '2099-01-01T00:00:00Z',
    'gender': 'ذكر',
    'wealthLevel': 20,
    'hideWealthLevel': false,
    'level': 99,
  };

  test('a current VIP takes priority over gender-specific rank', () {
    expect(homeIdentityLabel(activeVip), 'VIP 4');
    const person = DiscoveryPerson(id: 'vip', data: activeVip);
    expect(person.vipLevel, 4);
    expect(person.identityLabel, 'VIP 4');
  });

  test('expired VIP is never mistaken for a current badge', () {
    const expired = <String, dynamic>{
      'effectiveVipLevel': 6,
      'vipExpiresAt': '2020-01-01T00:00:00Z',
      'vipLevel': 10,
      'level': 100,
    };
    expect(homeIdentityLabel(expired), isNull);
    expect(const DiscoveryPerson(id: 'old', data: expired).vipLevel, 0);
  });

  test('gender fallback is shown only with verified public visibility', () {
    expect(
      homeIdentityLabel(const {
        'gender': 'ذكر',
        'wealthLevel': 12,
        'hideWealthLevel': false,
      }),
      'الثروة 12',
    );
    expect(
      homeIdentityLabel(const {
        'gender': 'أنثى',
        'attractionLevel': 9,
        'hideAttractionLevel': false,
      }),
      'الجاذبية 9',
    );
    expect(homeIdentityLabel(const {'gender': 'ذكر', 'wealthLevel': 12}),
        isNull);
    expect(
      homeIdentityLabel(const {
        'gender': 'أنثى',
        'attractionLevel': 9,
        'hideAttractionLevel': true,
      }),
      isNull,
    );
    expect(
      homeIdentityLabel(const {
        'gender': 'ذكر',
        'wealthLevel': 12,
        'level': 88,
      }, isOwnAccount: true),
      'الثروة 12',
    );
    expect(homeIdentityLabel(const {'level': 88}), isNull);
  });

  test('rank users using verified VIP and visible gender rank only', () {
    const feed = HomeDiscoveryData(
      userData: null,
      config: {},
      rooms: [],
      people: [
        DiscoveryPerson(id: 'c', data: {'level': 900}),
        DiscoveryPerson(id: 'b', data: {
          'gender': 'أنثى',
          'attractionLevel': 8,
          'hideAttractionLevel': false,
        }),
        DiscoveryPerson(id: 'a', data: activeVip),
        DiscoveryPerson(id: 'd', data: {
          'gender': 'ذكر',
          'wealthLevel': 100,
          'hideWealthLevel': true,
        }),
      ],
    );
    expect(feed.suggestedPeople.map((p) => p.id).toList(),
        ['a', 'b', 'c', 'd']);
  });

  test('home screen does not present legacy generic LV text', () {
    final source = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    expect(source.contains("userData?['level']"), isFalse);
    expect(source.contains("'LV.$level'"), isFalse);
    expect(source.contains("'LV.${person.level}'"), isFalse);
    expect(source.contains('المستوى غير متاح'), isFalse);
    expect(source.contains('homeIdentityLabel('), isTrue);
  });
}
