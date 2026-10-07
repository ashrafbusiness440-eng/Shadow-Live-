import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class OwnerAgencyWallet {
  const OwnerAgencyWallet({
    required this.diamonds,
    required this.remainderCoins,
    required this.lifetimeDiamonds,
  });

  final int diamonds;
  final int remainderCoins;
  final int lifetimeDiamonds;

  factory OwnerAgencyWallet.fromJson(Map<String, dynamic> json) {
    return OwnerAgencyWallet(
      diamonds: _int(json['diamonds']),
      remainderCoins: _int(json['remainderCoins']),
      lifetimeDiamonds: _int(json['lifetimeDiamonds']),
    );
  }
}

class OwnerAgencyBonus {
  const OwnerAgencyBonus({
    required this.eligible,
    required this.requiredActiveHosts,
    required this.bps,
    required this.estimatedCoins,
    required this.deferredToMonthEnd,
  });

  final bool eligible;
  final int requiredActiveHosts;
  final int bps;
  final int estimatedCoins;
  final bool deferredToMonthEnd;

  factory OwnerAgencyBonus.fromJson(Map<String, dynamic> json) {
    return OwnerAgencyBonus(
      eligible: json['eligible'] == true,
      requiredActiveHosts: _int(json['requiredActiveHosts']),
      bps: _int(json['bps']),
      estimatedCoins: _int(json['estimatedCoins']),
      deferredToMonthEnd: json['deferredToMonthEnd'] == true,
    );
  }
}

class OwnerAgencyPerformance {
  const OwnerAgencyPerformance({
    required this.month,
    required this.supportCoins,
    required this.hostShareCoins,
    required this.agencyBaseShareCoins,
    required this.platformShareCoins,
    required this.giftCount,
    required this.activeHostCount,
    required this.bonus,
    required this.wallet,
  });

  final String month;
  final int supportCoins;
  final int hostShareCoins;
  final int agencyBaseShareCoins;
  final int platformShareCoins;
  final int giftCount;
  final int activeHostCount;
  final OwnerAgencyBonus bonus;
  final OwnerAgencyWallet wallet;

  int get estimatedAgencyPayableCoins =>
      agencyBaseShareCoins + bonus.estimatedCoins;

  factory OwnerAgencyPerformance.fromJson(Map<String, dynamic> json) {
    final bonus = json['bonus'];
    final wallet = json['wallet'];
    if (bonus is! Map || wallet is! Map) {
      throw const FormatException('invalid_owner_agency_performance');
    }
    return OwnerAgencyPerformance(
      month: (json['month'] ?? '').toString(),
      supportCoins: _int(json['supportCoins']),
      hostShareCoins: _int(json['hostShareCoins']),
      agencyBaseShareCoins: _int(json['agencyBaseShareCoins']),
      platformShareCoins: _int(json['platformShareCoins']),
      giftCount: _int(json['giftCount']),
      activeHostCount: _int(json['activeHostCount']),
      bonus: OwnerAgencyBonus.fromJson(Map<String, dynamic>.from(bonus)),
      wallet: OwnerAgencyWallet.fromJson(Map<String, dynamic>.from(wallet)),
    );
  }
}

class OwnerAgencyPerformanceData {
  const OwnerAgencyPerformanceData({
    required this.agencyId,
    required this.current,
    required this.coinsPerDiamond,
    required this.policySource,
  });

  final String agencyId;
  final OwnerAgencyPerformance current;
  final int coinsPerDiamond;
  final String policySource;

  factory OwnerAgencyPerformanceData.fromJson(Map<String, dynamic> json) {
    final current = json['current'];
    final policy = json['policy'];
    if (current is! Map || policy is! Map) {
      throw const FormatException('invalid_owner_agency_performance');
    }
    return OwnerAgencyPerformanceData(
      agencyId: (json['agencyId'] ?? '').toString(),
      current: OwnerAgencyPerformance.fromJson(
        Map<String, dynamic>.from(current),
      ),
      coinsPerDiamond: _int(policy['coinsPerDiamond']),
      policySource: (policy['source'] ?? 'global').toString(),
    );
  }
}

class OwnerAgencyStatement {
  const OwnerAgencyStatement({
    required this.month,
    required this.settled,
    required this.supportCoins,
    required this.agencyBaseShareCoins,
    required this.agencyBonusCoins,
    required this.agencyPayableCoins,
    required this.agencyDiamonds,
    required this.agencyRemainderCoins,
    required this.activeHostCount,
    required this.requiredActiveHosts,
    required this.bonusEligible,
    required this.bonusBps,
    required this.giftCount,
  });

  final String month;
  final bool settled;
  final int supportCoins;
  final int agencyBaseShareCoins;
  final int agencyBonusCoins;
  final int agencyPayableCoins;
  final int agencyDiamonds;
  final int agencyRemainderCoins;
  final int activeHostCount;
  final int requiredActiveHosts;
  final bool bonusEligible;
  final int bonusBps;
  final int giftCount;

  factory OwnerAgencyStatement.fromJson(Map<String, dynamic> json) {
    final settled = json['settled'] == true;
    final statement = json['statement'];
    final data = statement is Map
        ? Map<String, dynamic>.from(statement)
        : const <String, dynamic>{};
    return OwnerAgencyStatement(
      month: (json['month'] ?? '').toString(),
      settled: settled,
      supportCoins: _int(data['supportCoins']),
      agencyBaseShareCoins: _int(data['agencyBaseShareCoins']),
      agencyBonusCoins: _int(data['agencyBonusCoins']),
      agencyPayableCoins: _int(data['agencyPayableCoins']),
      agencyDiamonds: _int(data['agencyDiamonds']),
      agencyRemainderCoins: _int(data['agencyRemainderCoins']),
      activeHostCount: _int(data['activeHostCount']),
      requiredActiveHosts: _int(data['requiredActiveHosts']),
      bonusEligible: data['bonusEligible'] == true,
      bonusBps: _int(data['bonusBps']),
      giftCount: _int(data['giftCount']),
    );
  }
}

class OwnerAgencyMember {
  const OwnerAgencyMember({
    required this.uid,
    required this.role,
    required this.status,
    required this.publicId,
    required this.displayName,
    required this.profileImageUrl,
    this.profileAvatarAsset,
    required this.accountStatus,
  });

  final String uid;
  final String role;
  final String status;
  final String? publicId;
  final String? displayName;
  final String? profileImageUrl;
  final String? profileAvatarAsset;
  final String accountStatus;

  factory OwnerAgencyMember.fromJson(Map<String, dynamic> json) {
    return OwnerAgencyMember(
      uid: (json['uid'] ?? '').toString(),
      role: (json['role'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      publicId: _nullable(json['publicId']),
      displayName: _nullable(json['displayName']),
      profileImageUrl: _nullable(json['profileImageUrl']),
      profileAvatarAsset: _nullable(json['profileAvatarAsset']),
      accountStatus: (json['accountStatus'] ?? 'active').toString(),
    );
  }
}

class OwnerAgencyMembersData {
  const OwnerAgencyMembersData({
    required this.memberCount,
    required this.hostCount,
    required this.managerCount,
    required this.seniorManagerCount,
    required this.truncated,
    required this.members,
  });

  final int memberCount;
  final int hostCount;
  final int managerCount;
  final int seniorManagerCount;
  final bool truncated;
  final List<OwnerAgencyMember> members;

  factory OwnerAgencyMembersData.fromJson(Map<String, dynamic> json) {
    final agency = json['agency'];
    final members = json['members'];
    if (agency is! Map || members is! List) {
      throw const FormatException('invalid_owner_agency_members');
    }
    final agencyMap = Map<String, dynamic>.from(agency);
    return OwnerAgencyMembersData(
      memberCount: _int(agencyMap['memberCount']),
      hostCount: _int(agencyMap['hostCount']),
      managerCount: _int(agencyMap['managerCount']),
      seniorManagerCount: _int(agencyMap['seniorManagerCount']),
      truncated: json['truncated'] == true,
      members: members
          .whereType<Map>()
          .map((item) => OwnerAgencyMember.fromJson(
                Map<String, dynamic>.from(item),
              ))
          .toList(growable: false),
    );
  }
}

class ManagerHostPerformanceLevel {
  const ManagerHostPerformanceLevel({
    required this.id,
    required this.tierId,
    required this.rank,
    required this.thresholdCoins,
    required this.openEnded,
  });

  final String id;
  final String tierId;
  final String rank;
  final int thresholdCoins;
  final bool openEnded;

  factory ManagerHostPerformanceLevel.fromJson(Map<String, dynamic> json) {
    return ManagerHostPerformanceLevel(
      id: (json['id'] ?? '').toString(),
      tierId: (json['tierId'] ?? '').toString(),
      rank: (json['rank'] ?? '').toString(),
      thresholdCoins: _int(json['thresholdCoins']),
      openEnded: json['openEnded'] == true,
    );
  }
}

class ManagerHostPerformanceData {
  const ManagerHostPerformanceData({
    required this.uid,
    required this.publicId,
    required this.displayName,
    required this.profileImageUrl,
    this.profileAvatarAsset,
    required this.role,
    required this.status,
    required this.accountStatus,
    required this.month,
    required this.progressCoins,
    required this.progressBps,
    required this.remainingCoins,
    required this.targetCoins,
    required this.currentLevel,
    required this.nextLevel,
    required this.qualifiedDays,
    required this.micSecondsMonth,
    required this.requiredQualifiedDays,
    required this.requiredMinutesPerDay,
    required this.requiredMicSecondsMonth,
  });

  final String uid;
  final String? publicId;
  final String displayName;
  final String? profileImageUrl;
  final String? profileAvatarAsset;
  final String role;
  final String status;
  final String accountStatus;
  final String month;
  final int progressCoins;
  final int progressBps;
  final int remainingCoins;
  final int targetCoins;
  final ManagerHostPerformanceLevel? currentLevel;
  final ManagerHostPerformanceLevel? nextLevel;
  final int qualifiedDays;
  final int micSecondsMonth;
  final int requiredQualifiedDays;
  final int requiredMinutesPerDay;
  final int requiredMicSecondsMonth;

  factory ManagerHostPerformanceData.fromJson(Map<String, dynamic> json) {
    final host = json['host'];
    final target = json['target'];
    final activity = json['activity'];
    if (host is! Map || target is! Map || activity is! Map) {
      throw const FormatException('invalid_manager_host_performance');
    }
    final hostMap = Map<String, dynamic>.from(host);
    final targetMap = Map<String, dynamic>.from(target);
    final activityMap = Map<String, dynamic>.from(activity);

    ManagerHostPerformanceLevel? parseLevel(dynamic raw) {
      if (raw is! Map) return null;
      return ManagerHostPerformanceLevel.fromJson(
        Map<String, dynamic>.from(raw),
      );
    }

    return ManagerHostPerformanceData(
      uid: (hostMap['uid'] ?? '').toString(),
      publicId: _nullable(hostMap['publicId']),
      displayName: (hostMap['displayName'] ?? 'Shadow Live').toString(),
      profileImageUrl: _nullable(hostMap['profileImageUrl']),
      profileAvatarAsset: _nullable(hostMap['profileAvatarAsset']),
      role: (hostMap['role'] ?? '').toString(),
      status: (hostMap['status'] ?? '').toString(),
      accountStatus: (hostMap['accountStatus'] ?? 'active').toString(),
      month: (targetMap['month'] ?? '').toString(),
      progressCoins: _int(targetMap['progressCoins']),
      progressBps: _int(targetMap['progressBps']),
      remainingCoins: _int(targetMap['remainingCoins']),
      targetCoins: _int(targetMap['targetCoins']),
      currentLevel: parseLevel(targetMap['currentLevel']),
      nextLevel: parseLevel(targetMap['nextLevel']),
      qualifiedDays: _int(activityMap['qualifiedDays']),
      micSecondsMonth: _int(activityMap['micSecondsMonth']),
      requiredQualifiedDays: _int(activityMap['requiredQualifiedDays']),
      requiredMinutesPerDay: _int(activityMap['requiredMinutesPerDay']),
      requiredMicSecondsMonth: _int(activityMap['requiredMicSecondsMonth']),
    );
  }
}

class OwnerHostPerformanceLevel {
  const OwnerHostPerformanceLevel({
    required this.id,
    required this.tierId,
    required this.rank,
    required this.thresholdCoins,
    required this.salaryDiamonds,
    required this.openEnded,
  });

  final String id;
  final String tierId;
  final String rank;
  final int thresholdCoins;
  final int salaryDiamonds;
  final bool openEnded;

  factory OwnerHostPerformanceLevel.fromJson(Map<String, dynamic> json) {
    return OwnerHostPerformanceLevel(
      id: (json['id'] ?? '').toString(),
      tierId: (json['tierId'] ?? '').toString(),
      rank: (json['rank'] ?? '').toString(),
      thresholdCoins: _int(json['thresholdCoins']),
      salaryDiamonds: _int(json['salaryDiamonds']),
      openEnded: json['openEnded'] == true,
    );
  }
}

class OwnerHostAchievement {
  const OwnerHostAchievement({
    required this.targetId,
    required this.tierId,
    required this.rank,
    required this.thresholdCoins,
    required this.achievedAt,
  });

  final String targetId;
  final String tierId;
  final String rank;
  final int thresholdCoins;
  final DateTime? achievedAt;

  factory OwnerHostAchievement.fromJson(Map<String, dynamic> json) {
    return OwnerHostAchievement(
      targetId: (json['targetId'] ?? '').toString(),
      tierId: (json['tierId'] ?? '').toString(),
      rank: (json['rank'] ?? '').toString(),
      thresholdCoins: _int(json['thresholdCoins']),
      achievedAt: _dateTime(json['achievedAt']),
    );
  }
}

class OwnerHostPerformanceData {
  const OwnerHostPerformanceData({
    required this.uid,
    required this.publicId,
    required this.displayName,
    required this.profileImageUrl,
    this.profileAvatarAsset,
    required this.role,
    required this.status,
    required this.accountStatus,
    required this.month,
    required this.progressCoins,
    required this.remainingCoins,
    required this.targetCoins,
    required this.currentLevel,
    required this.nextLevel,
    required this.levels,
    required this.qualifiedDays,
    required this.micSecondsMonth,
    required this.requiredQualifiedDays,
    required this.requiredMinutesPerDay,
    required this.requiredMicSecondsMonth,
    required this.achievements,
  });

  final String uid;
  final String? publicId;
  final String displayName;
  final String? profileImageUrl;
  final String? profileAvatarAsset;
  final String role;
  final String status;
  final String accountStatus;
  final String month;
  final int progressCoins;
  final int remainingCoins;
  final int targetCoins;
  final OwnerHostPerformanceLevel? currentLevel;
  final OwnerHostPerformanceLevel? nextLevel;
  final List<OwnerHostPerformanceLevel> levels;
  final int qualifiedDays;
  final int micSecondsMonth;
  final int requiredQualifiedDays;
  final int requiredMinutesPerDay;
  final int requiredMicSecondsMonth;
  final List<OwnerHostAchievement> achievements;

  factory OwnerHostPerformanceData.fromJson(Map<String, dynamic> json) {
    final host = json['host'];
    final target = json['target'];
    final activity = json['activity'];
    if (host is! Map || target is! Map || activity is! Map) {
      throw const FormatException('invalid_owner_host_performance');
    }
    final hostMap = Map<String, dynamic>.from(host);
    final targetMap = Map<String, dynamic>.from(target);
    final activityMap = Map<String, dynamic>.from(activity);
    final rawLevels = targetMap['levels'];
    final rawAchievements = json['achievements'];
    OwnerHostPerformanceLevel? parseLevel(dynamic raw) {
      if (raw is! Map) return null;
      return OwnerHostPerformanceLevel.fromJson(
        Map<String, dynamic>.from(raw),
      );
    }

    return OwnerHostPerformanceData(
      uid: (hostMap['uid'] ?? '').toString(),
      publicId: _nullable(hostMap['publicId']),
      displayName:
          (hostMap['displayName'] ?? 'Shadow Live').toString(),
      profileImageUrl: _nullable(hostMap['profileImageUrl']),
      profileAvatarAsset: _nullable(hostMap['profileAvatarAsset']),
      role: (hostMap['role'] ?? '').toString(),
      status: (hostMap['status'] ?? '').toString(),
      accountStatus: (hostMap['accountStatus'] ?? 'active').toString(),
      month: (targetMap['month'] ?? '').toString(),
      progressCoins: _int(targetMap['progressCoins']),
      remainingCoins: _int(targetMap['remainingCoins']),
      targetCoins: _int(targetMap['targetCoins']),
      currentLevel: parseLevel(targetMap['currentLevel']),
      nextLevel: parseLevel(targetMap['nextLevel']),
      levels: rawLevels is List
          ? rawLevels
              .whereType<Map>()
              .map((item) => OwnerHostPerformanceLevel.fromJson(
                    Map<String, dynamic>.from(item),
                  ))
              .toList(growable: false)
          : const <OwnerHostPerformanceLevel>[],
      qualifiedDays: _int(activityMap['qualifiedDays']),
      micSecondsMonth: _int(activityMap['micSecondsMonth']),
      requiredQualifiedDays: _int(activityMap['requiredQualifiedDays']),
      requiredMinutesPerDay: _int(activityMap['requiredMinutesPerDay']),
      requiredMicSecondsMonth: _int(
        activityMap['requiredMicSecondsMonth'],
      ),
      achievements: rawAchievements is List
          ? rawAchievements
              .whereType<Map>()
              .map((item) => OwnerHostAchievement.fromJson(
                    Map<String, dynamic>.from(item),
                  ))
              .toList(growable: false)
          : const <OwnerHostAchievement>[],
    );
  }
}

class OwnerAgencyPendingRequest {
  const OwnerAgencyPendingRequest({
    required this.requestId,
    required this.uid,
    required this.userPublicId,
    required this.displayName,
    required this.profileImageUrl,
    this.profileAvatarAsset,
    required this.type,
    required this.targetRole,
    required this.status,
    required this.createdAt,
    required this.accountStatus,
    required this.conflictStatus,
  });

  final String requestId;
  final String uid;
  final String? userPublicId;
  final String? displayName;
  final String? profileImageUrl;
  final String? profileAvatarAsset;
  final String type;
  final String targetRole;
  final String status;
  final DateTime? createdAt;
  final String accountStatus;
  final String conflictStatus;

  bool get canAccept =>
      status == 'pending' &&
      conflictStatus == 'none' &&
      accountStatus == 'active';

  factory OwnerAgencyPendingRequest.fromJson(Map<String, dynamic> json) {
    return OwnerAgencyPendingRequest(
      requestId: (json['requestId'] ?? '').toString(),
      uid: (json['uid'] ?? '').toString(),
      userPublicId: _nullable(json['userPublicId']),
      displayName: _nullable(json['displayName']),
      profileImageUrl: _nullable(json['profileImageUrl']),
      profileAvatarAsset: _nullable(json['profileAvatarAsset']),
      type: (json['type'] ?? '').toString(),
      targetRole: (json['targetRole'] ?? 'host').toString(),
      status: (json['status'] ?? '').toString(),
      createdAt: _dateTime(json['createdAt']),
      accountStatus: (json['accountStatus'] ?? 'active').toString(),
      conflictStatus: (json['conflictStatus'] ?? 'none').toString(),
    );
  }
}

class OwnerAgencyPendingPage {
  const OwnerAgencyPendingPage({
    required this.requests,
    required this.hasMore,
    required this.nextOffset,
    required this.truncated,
  });

  final List<OwnerAgencyPendingRequest> requests;
  final bool hasMore;
  final int? nextOffset;
  final bool truncated;

  factory OwnerAgencyPendingPage.fromJson(Map<String, dynamic> json) {
    final requests = json['requests'];
    if (requests is! List) {
      throw const FormatException('invalid_owner_agency_pending');
    }
    return OwnerAgencyPendingPage(
      requests: requests
          .whereType<Map>()
          .map(
            (item) => OwnerAgencyPendingRequest.fromJson(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList(growable: false),
      hasMore: json['hasMore'] == true,
      nextOffset: json['nextOffset'] is num
          ? (json['nextOffset'] as num).toInt()
          : int.tryParse('${json['nextOffset'] ?? ''}'),
      truncated: json['truncated'] == true,
    );
  }
}

class OwnerAgencyService {
  OwnerAgencyService({
    http.Client? client,
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final bool _ownsClient;
  final FirebaseAuth _auth;
  final String _baseUrl;

  Future<String> _token() async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Future<Map<String, dynamic>> _postMembership(
    Map<String, dynamic> body,
  ) async {
    final token = await _token();
    final response = await _client.post(
      Uri.parse('$_baseUrl/agency-membership'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(body),
    );
    Map<String, dynamic> decoded = const {};
    try {
      final value = jsonDecode(response.body);
      if (value is Map) decoded = Map<String, dynamic>.from(value);
    } catch (_) {}
    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'agency_membership_management_failed').toString(),
      );
    }
    return decoded;
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _token();
    final response = await _client.post(
      Uri.parse('$_baseUrl/agency-owner'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(body),
    );
    Map<String, dynamic> decoded = const {};
    try {
      final value = jsonDecode(response.body);
      if (value is Map) decoded = Map<String, dynamic>.from(value);
    } catch (_) {}
    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'agency_owner_load_failed').toString(),
      );
    }
    return decoded;
  }

  Future<OwnerAgencyPerformanceData> loadPerformance() async {
    final body = await _post(const {'action': 'performance'});
    return OwnerAgencyPerformanceData.fromJson(body);
  }

  Future<OwnerHostPerformanceData> loadHostPerformance(
    String targetUid,
  ) async {
    final body = await _post({
      'action': 'hostPerformance',
      'targetUid': targetUid.trim(),
    });
    return OwnerHostPerformanceData.fromJson(body);
  }

  Future<OwnerAgencyStatement> loadStatement(String month) async {
    final body = await _post({
      'action': 'statement',
      'month': month.trim(),
    });
    return OwnerAgencyStatement.fromJson(body);
  }

  Future<OwnerAgencyMembersData> loadMembers(String agencyId) async {
    final body = await _postMembership({
      'action': 'listAgencyMembers',
      'agencyId': agencyId.trim(),
      'limit': 25,
    });
    return OwnerAgencyMembersData.fromJson(body);
  }

  Future<ManagerHostPerformanceData> loadManagerHostPerformance({
    required String agencyId,
    required String targetUid,
  }) async {
    final body = await _postMembership({
      'action': 'memberPerformance',
      'agencyId': agencyId.trim(),
      'targetUid': targetUid.trim(),
    });
    return ManagerHostPerformanceData.fromJson(body);
  }

  Future<OwnerAgencyPendingPage> loadPendingPage(
    String agencyId, {
    int offset = 0,
  }) async {
    final body = await _postMembership({
      'action': 'listAgencyPending',
      'agencyId': agencyId.trim(),
      'limit': 25,
      'offset': offset < 0 ? 0 : offset,
    });
    return OwnerAgencyPendingPage.fromJson(body);
  }

  Future<List<OwnerAgencyPendingRequest>> loadPending(String agencyId) async {
    return (await loadPendingPage(agencyId)).requests;
  }

  Future<void> inviteHost({
    required String agencyId,
    required String targetPublicId,
    required String idempotencyKey,
  }) async {
    await _postMembership({
      'action': 'invite',
      'agencyId': agencyId.trim(),
      'targetPublicId': targetPublicId.trim(),
      'idempotencyKey': idempotencyKey,
    });
  }

  Future<void> respondJoin({
    required String requestId,
    required String decision,
    required String idempotencyKey,
    String? reason,
  }) async {
    await _postMembership({
      'action': 'respond',
      'requestId': requestId,
      'decision': decision,
      'idempotencyKey': idempotencyKey,
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  Future<void> respondLeave({
    required String requestId,
    required String decision,
    required String idempotencyKey,
    String? reason,
  }) async {
    await _postMembership({
      'action': 'respondLeave',
      'requestId': requestId,
      'decision': decision,
      'idempotencyKey': idempotencyKey,
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  Future<void> cancelRequest({
    required String requestId,
    required String idempotencyKey,
    String? reason,
  }) async {
    await _postMembership({
      'action': 'cancel',
      'requestId': requestId,
      'idempotencyKey': idempotencyKey,
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  Future<void> setManagerRole({
    required String agencyId,
    required String targetUid,
    required String targetRole,
    required String idempotencyKey,
  }) async {
    await _postMembership({
      'action': 'setManagerRole',
      'agencyId': agencyId.trim(),
      'targetUid': targetUid,
      'targetRole': targetRole,
      'idempotencyKey': idempotencyKey,
    });
  }

  Future<void> removeMember({
    required String agencyId,
    required String targetUid,
    required String idempotencyKey,
    String? reason,
  }) async {
    await _postMembership({
      'action': 'remove',
      'agencyId': agencyId.trim(),
      'targetUid': targetUid,
      'idempotencyKey': idempotencyKey,
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

DateTime? _dateTime(dynamic value) {
  if (value is DateTime) return value;
  final text = (value ?? '').toString().trim();
  if (text.isEmpty) return null;
  return DateTime.tryParse(text);
}

String? _nullable(dynamic value) {
  final text = (value ?? '').toString().trim();
  return text.isEmpty ? null : text;
}

int _int(dynamic value) {
  final n = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
  return n < 0 ? 0 : n;
}
