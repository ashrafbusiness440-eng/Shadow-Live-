import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/agency/services/host_my_agency_service.dart';

void main() {
  test('11-A parses Host My Agency core response', () {
    final data = HostMyAgencyCoreData.fromJson({
      'agency': {
        'agencyId': '741201',
        'publicId': '741201',
        'name': 'Host Core Agency',
        'country': 'AE',
        'status': 'active',
      },
      'owner': {
        'uid': 'owner-1',
        'publicId': '930001',
        'displayName': 'Agency Owner',
        'profileImageUrl': 'https://example.invalid/owner.webp',
      },
      'membership': {
        'role': 'host',
        'status': 'active',
      },
      'target': {
        'month': '2026-09',
        'progressCoins': 650000,
        'paidDiamonds': 65,
        'remainingCoins': 200000,
        'targetCoins': 850000,
        'currentLevel': {
          'id': 'starter_b',
          'tierId': 'starter',
          'rank': 'B',
          'thresholdCoins': 650000,
          'salaryDiamonds': 65,
          'openEnded': false,
        },
        'nextLevel': {
          'id': 'starter_a',
          'tierId': 'starter',
          'rank': 'A',
          'thresholdCoins': 850000,
          'salaryDiamonds': 85,
          'openEnded': false,
        },
      },
      'activity': {
        'month': '2026-09',
        'qualifiedDays': 7,
        'micSecondsMonth': 54000,
        'requiredQualifiedDays': 9,
        'requiredMinutesPerDay': 120,
      },
    });

    expect(data.agency.agencyId, '741201');
    expect(data.agency.name, 'Host Core Agency');
    expect(data.owner.uid, 'owner-1');
    expect(data.membershipRole, 'host');
    expect(data.membershipStatus, 'active');
    expect(data.target.progressCoins, 650000);
    expect(data.target.paidDiamonds, 65);
    expect(data.target.remainingCoins, 200000);
    expect(data.target.currentLevel?.rank, 'B');
    expect(data.target.nextLevel?.rank, 'A');
    expect(data.activity.qualifiedDays, 7);
    expect(data.activity.requiredQualifiedDays, 9);
    expect(data.activity.requiredMinutesPerDay, 120);
  });

  test('11-A tolerates absent optional Agency and level fields', () {
    final data = HostMyAgencyCoreData.fromJson({
      'agency': {
        'agencyId': '741202',
        'name': 'Agency',
        'status': 'suspended',
      },
      'owner': {
        'uid': 'owner-2',
        'displayName': 'Owner',
      },
      'membership': {
        'role': 'owner',
        'status': 'active',
      },
      'target': {
        'month': '2026-09',
        'progressCoins': 0,
        'paidDiamonds': 0,
        'remainingCoins': 50000,
        'targetCoins': 50000,
      },
      'activity': {
        'month': '2026-09',
        'qualifiedDays': 0,
        'micSecondsMonth': 0,
        'requiredQualifiedDays': 9,
        'requiredMinutesPerDay': 120,
      },
    });

    expect(data.agency.publicId, '741202');
    expect(data.agency.country, isNull);
    expect(data.agency.logoUrl, isNull);
    expect(data.target.currentLevel, isNull);
    expect(data.target.nextLevel, isNull);
    expect(data.owner.publicId, isNull);
  });
}
