import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/agency/services/owner_agency_service.dart';

void main() {
  test('12-B parses current Agency earnings/performance', () {
    final data = OwnerAgencyPerformanceData.fromJson({
      'agencyId': '812002',
      'current': {
        'month': '2026-09',
        'supportCoins': 1000000,
        'hostShareCoins': 570000,
        'agencyBaseShareCoins': 60000,
        'platformShareCoins': 370000,
        'giftCount': 25,
        'activeHostCount': 10,
        'bonus': {
          'eligible': true,
          'requiredActiveHosts': 8,
          'bps': 150,
          'estimatedCoins': 15000,
          'deferredToMonthEnd': true,
        },
        'wallet': {
          'diamonds': 42,
          'remainderCoins': 3500,
          'lifetimeDiamonds': 90,
        },
      },
      'policy': {
        'coinsPerDiamond': 10000,
        'source': 'agency_override',
      },
    });

    expect(data.agencyId, '812002');
    expect(data.current.month, '2026-09');
    expect(data.current.supportCoins, 1000000);
    expect(data.current.agencyBaseShareCoins, 60000);
    expect(data.current.bonus.eligible, isTrue);
    expect(data.current.bonus.requiredActiveHosts, 8);
    expect(data.current.bonus.estimatedCoins, 15000);
    expect(data.current.estimatedAgencyPayableCoins, 75000);
    expect(data.current.wallet.diamonds, 42);
    expect(data.current.wallet.remainderCoins, 3500);
    expect(data.coinsPerDiamond, 10000);
    expect(data.policySource, 'agency_override');
  });

  test('12-B parses settled and missing monthly statements', () {
    final settled = OwnerAgencyStatement.fromJson({
      'month': '2026-08',
      'settled': true,
      'statement': {
        'supportCoins': 2000000,
        'agencyBaseShareCoins': 120000,
        'agencyBonusCoins': 40000,
        'agencyPayableCoins': 160000,
        'agencyDiamonds': 16,
        'agencyRemainderCoins': 3500,
        'activeHostCount': 12,
        'requiredActiveHosts': 10,
        'bonusEligible': true,
        'bonusBps': 200,
        'giftCount': 80,
      },
    });

    expect(settled.settled, isTrue);
    expect(settled.month, '2026-08');
    expect(settled.agencyPayableCoins, 160000);
    expect(settled.agencyDiamonds, 16);
    expect(settled.bonusEligible, isTrue);

    final missing = OwnerAgencyStatement.fromJson({
      'month': '2026-08',
      'settled': false,
      'statement': null,
    });
    expect(missing.settled, isFalse);
    expect(missing.agencyPayableCoins, 0);
    expect(missing.agencyDiamonds, 0);
  });
  test('12-C parses bounded Owner management payloads', () {
    final members = OwnerAgencyMembersData.fromJson({
      'agency': {
        'memberCount': 4,
        'hostCount': 1,
        'managerCount': 2,
        'seniorManagerCount': 0,
      },
      'truncated': false,
      'members': [
        {
          'uid': 'owner_1',
          'role': 'owner',
          'status': 'active',
          'publicId': '812301',
          'displayName': 'Owner',
        },
        {
          'uid': 'manager_1',
          'role': 'manager',
          'status': 'active',
          'publicId': '812302',
          'displayName': 'Manager',
        },
      ],
    });

    expect(members.memberCount, 4);
    expect(members.hostCount, 1);
    expect(members.managerCount, 2);
    expect(members.members.length, 2);
    expect(members.members[1].role, 'manager');

    final pending = OwnerAgencyPendingRequest.fromJson({
      'requestId': 'leave_1',
      'uid': 'host_1',
      'userPublicId': '812399',
      'type': 'leave',
      'status': 'pending',
    });
    expect(pending.type, 'leave');
    expect(pending.status, 'pending');
    expect(pending.userPublicId, '812399');
  });

}
