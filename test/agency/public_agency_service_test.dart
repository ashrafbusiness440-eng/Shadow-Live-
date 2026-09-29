import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/agency/services/public_agency_service.dart';

void main() {
  test('Stage 10-A parses public agency identity owner and Hosts page', () {
    final data = PublicAgencyPageData.fromJson({
      'ok': true,
      'agency': {
        'agencyId': '731204',
        'publicId': '731204',
        'name': 'Shadow Agency',
        'country': 'AE',
        'memberCount': 14,
        'hostCount': 10,
      },
      'owner': {
        'uid': 'owner_uid',
        'publicId': '100001',
        'displayName': 'Owner',
        'profileImageUrl': null,
      },
      'hosts': [
        {
          'uid': 'host_uid',
          'publicId': '100002',
          'displayName': 'Host',
          'profileImageUrl': 'https://example.invalid/host.webp',
        },
      ],
      'page': {
        'limit': 20,
        'hasMore': true,
        'nextCursor': 'host_uid',
      },
    });

    expect(data.agency.agencyId, '731204');
    expect(data.agency.publicId, '731204');
    expect(data.agency.name, 'Shadow Agency');
    expect(data.agency.country, 'AE');
    expect(data.agency.memberCount, 14);
    expect(data.agency.hostCount, 10);
    expect(data.owner.uid, 'owner_uid');
    expect(data.hosts.single.uid, 'host_uid');
    expect(data.hasMore, isTrue);
    expect(data.nextCursor, 'host_uid');
  });

  test('Stage 10-A normalizes negative counters and optional values', () {
    final data = PublicAgencyPageData.fromJson({
      'agency': {
        'agencyId': '731205',
        'name': 'Agency',
        'country': '',
        'memberCount': -5,
        'hostCount': -1,
      },
      'owner': {
        'uid': 'owner',
        'displayName': 'Owner',
        'publicId': '',
      },
      'hosts': const [],
      'page': {
        'limit': 20,
        'hasMore': false,
        'nextCursor': '',
      },
    });

    expect(data.agency.memberCount, 0);
    expect(data.agency.hostCount, 0);
    expect(data.agency.country, isNull);
    expect(data.owner.publicId, isNull);
    expect(data.hasMore, isFalse);
    expect(data.nextCursor, isNull);
  });
}
