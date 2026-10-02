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

  test('Stage 10-B parses Top 10 public support ranking without financial fields', () {
    final data = PublicAgencyRankingData.fromJson({
      'month': '2026-09',
      'currentMonth': '2026-09',
      'top10': [
        {
          'rank': 1,
          'supportCoins': 1500000,
          'uid': 'host_a',
          'publicId': '200001',
          'displayName': 'Host A',
          'profileImageUrl': null,
          'profileAvatarAsset': 'assets/images/avatars/female_1.png',
        },
        {
          'rank': 2,
          'supportCoins': 750000,
          'uid': 'host_b',
          'publicId': '200002',
          'displayName': 'Host B',
          'profileImageUrl': 'https://example.invalid/b.webp',
        },
      ],
    });

    expect(data.month, '2026-09');
    expect(data.currentMonth, '2026-09');
    expect(data.top10.length, 2);
    expect(data.top10.first.rank, 1);
    expect(data.top10.first.supportCoins, 1500000);
    expect(data.top10.first.person.uid, 'host_a');
    expect(
      data.top10.first.person.profileAvatarAsset,
      'assets/images/avatars/female_1.png',
    );
    expect(data.top10.last.rank, 2);
  });

  test('Stage 10-B parses bounded monthly archive months in order', () {
    final data = PublicAgencyArchiveData.fromJson({
      'currentMonth': '2026-09',
      'months': ['2026-08', '2026-06'],
      'maxMonths': 6,
    });

    expect(data.currentMonth, '2026-09');
    expect(data.months, ['2026-08', '2026-06']);
    expect(data.maxMonths, 6);
  });

  test('Batch 2 parses discovery visuals ranking and bounded state', () {
    final data = PublicAgencySearchData.fromJson({
      'results': [
        {
          'agencyId': '815090',
          'publicId': '815090',
          'name': 'Top Shadow',
          'country': 'الباشان',
          'memberCount': 22,
          'hostCount': 14,
          'logoUrl': 'https://example.invalid/logo.webp',
          'coverUrl': 'https://example.invalid/cover.webp',
          'topValue': 990000,
          'rank': 3,
        },
      ],
      'page': {
        'limit': 20,
        'hasMore': false,
        'nextCursor': null,
        'truncated': true,
      },
    });

    final agency = data.results.single;
    expect(agency.logoUrl, 'https://example.invalid/logo.webp');
    expect(agency.coverUrl, 'https://example.invalid/cover.webp');
    expect(agency.topValue, 990000);
    expect(agency.rank, 3);
    expect(data.truncated, isTrue);
  });

  test('Stage 15-A parses bounded Agency search results and cursor', () {
    final data = PublicAgencySearchData.fromJson({
      'results': [
        {
          'agencyId': '815001',
          'publicId': '815001',
          'name': 'Shadow Agency',
          'country': 'UAE',
          'memberCount': 7,
          'hostCount': 5,
        },
      ],
      'page': {
        'limit': 20,
        'hasMore': true,
        'nextCursor': 'Shadow Agency|815001',
      },
    });

    expect(data.results.single.agencyId, '815001');
    expect(data.results.single.country, 'UAE');
    expect(data.limit, 20);
    expect(data.hasMore, isTrue);
    expect(data.nextCursor, 'Shadow Agency|815001');
  });

}
