import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;


class VipPolicyLevel {
  const VipPolicyLevel({
    required this.level,
    required this.growthRequirement,
    required this.maintenanceRequired,
    required this.validityDays,
    required this.downgradeRetentionBps,
  });

  final int level;
  final int growthRequirement;
  final int maintenanceRequired;
  final int validityDays;
  final int downgradeRetentionBps;

  factory VipPolicyLevel.fromJson(Map<String, dynamic> json) {
    int value(String key) => (json[key] as num?)?.toInt() ??
        int.tryParse('${json[key] ?? ''}') ??
        0;
    return VipPolicyLevel(
      level: value('level').clamp(1, 10).toInt(),
      growthRequirement: value('growthRequirement'),
      maintenanceRequired: value('maintenanceRequired'),
      validityDays: value('validityDays'),
      downgradeRetentionBps: value('downgradeRetentionBps'),
    );
  }
}

class VipQuickPurchaseOffer {
  const VipQuickPurchaseOffer({
    required this.id,
    required this.labelAr,
    required this.growthPoints,
    required this.baseCoinCost,
    required this.finalCoinCost,
    required this.discountBps,
    required this.sortOrder,
  });

  final String id;
  final String labelAr;
  final int growthPoints;
  final int baseCoinCost;
  final int finalCoinCost;
  final int discountBps;
  final int sortOrder;

  factory VipQuickPurchaseOffer.fromJson(Map<String, dynamic> json) {
    int value(String key) => (json[key] as num?)?.toInt() ??
        int.tryParse('${json[key] ?? ''}') ??
        0;
    return VipQuickPurchaseOffer(
      id: '${json['id'] ?? ''}'.trim(),
      labelAr: '${json['labelAr'] ?? ''}'.trim(),
      growthPoints: value('growthPoints'),
      baseCoinCost: value('baseCoinCost'),
      finalCoinCost: value('finalCoinCost'),
      discountBps: value('discountBps'),
      sortOrder: value('sortOrder'),
    );
  }
}

class VipPolicyData {
  const VipPolicyData({
    required this.maxLevel,
    required this.maxGrowthPoints,
    required this.paidRechargeGrowthPerCoin,
    required this.purchasedGrowthPerCoin,
    required this.levels,
    required this.quickPurchaseOffers,
  });

  final int maxLevel;
  final int maxGrowthPoints;
  final int paidRechargeGrowthPerCoin;
  final int purchasedGrowthPerCoin;
  final List<VipPolicyLevel> levels;
  final List<VipQuickPurchaseOffer> quickPurchaseOffers;

  factory VipPolicyData.fromJson(Map<String, dynamic> json) {
    int value(String key) => (json[key] as num?)?.toInt() ??
        int.tryParse('${json[key] ?? ''}') ??
        0;
    final rawLevels = json['levels'];
    final rawOffers = json['quickPurchaseOffers'];
    final levels = rawLevels is List
        ? rawLevels
            .whereType<Map>()
            .map((item) =>
                VipPolicyLevel.fromJson(Map<String, dynamic>.from(item)))
            .toList(growable: false)
        : const <VipPolicyLevel>[];
    final offers = rawOffers is List
        ? rawOffers
            .whereType<Map>()
            .map((item) =>
                VipQuickPurchaseOffer.fromJson(Map<String, dynamic>.from(item)))
            .where((item) =>
                item.id.isNotEmpty &&
                item.growthPoints > 0 &&
                item.finalCoinCost > 0)
            .toList(growable: false)
        : const <VipQuickPurchaseOffer>[];
    return VipPolicyData(
      maxLevel: value('maxLevel').clamp(1, 10).toInt(),
      maxGrowthPoints: value('maxGrowthPoints'),
      paidRechargeGrowthPerCoin: value('paidRechargeGrowthPerCoin'),
      purchasedGrowthPerCoin: value('purchasedGrowthPerCoin'),
      levels: levels,
      quickPurchaseOffers: offers,
    );
  }
}

class VipHistoryEvent {
  const VipHistoryEvent({
    required this.source,
    required this.eventType,
    required this.level,
    required this.oldVipLevel,
    required this.newVipLevel,
    required this.deltaGrowthPoints,
    required this.growthPointsBefore,
    required this.growthPointsAfter,
    required this.coinCost,
    required this.baseCoins,
    required this.bonusCoinsExcluded,
    required this.createdAtMs,
  });

  final String source;
  final String eventType;
  final int level;
  final int oldVipLevel;
  final int newVipLevel;
  final int deltaGrowthPoints;
  final int growthPointsBefore;
  final int growthPointsAfter;
  final int coinCost;
  final int baseCoins;
  final int bonusCoinsExcluded;
  final int createdAtMs;

  factory VipHistoryEvent.fromJson(Map<String, dynamic> json) {
    int value(String key) => (json[key] as num?)?.toInt() ??
        int.tryParse('${json[key] ?? ''}') ??
        0;
    return VipHistoryEvent(
      source: '${json['source'] ?? ''}'.trim(),
      eventType: '${json['eventType'] ?? ''}'.trim(),
      level: value('level'),
      oldVipLevel: value('oldVipLevel'),
      newVipLevel: value('newVipLevel'),
      deltaGrowthPoints: value('deltaGrowthPoints'),
      growthPointsBefore: value('growthPointsBefore'),
      growthPointsAfter: value('growthPointsAfter'),
      coinCost: value('coinCost'),
      baseCoins: value('baseCoins'),
      bonusCoinsExcluded: value('bonusCoinsExcluded'),
      createdAtMs: value('createdAtMs'),
    );
  }
}

class VipHistoryPage {
  const VipHistoryPage({
    required this.events,
    required this.nextCursor,
    required this.hasMore,
    required this.pageSize,
  });

  final List<VipHistoryEvent> events;
  final String? nextCursor;
  final bool hasMore;
  final int pageSize;

  factory VipHistoryPage.fromJson(Map<String, dynamic> json) {
    final raw = json['events'];
    return VipHistoryPage(
      events: raw is List
          ? raw
              .whereType<Map>()
              .map((item) =>
                  VipHistoryEvent.fromJson(Map<String, dynamic>.from(item)))
              .toList(growable: false)
          : const <VipHistoryEvent>[],
      nextCursor: (json['nextCursor']?.toString().trim().isNotEmpty ?? false)
          ? json['nextCursor'].toString().trim()
          : null,
      hasMore: json['hasMore'] == true,
      pageSize: (json['pageSize'] as num?)?.toInt() ?? 20,
    );
  }
}

class VipSummaryData {
  const VipSummaryData({
    required this.effectiveVipLevel,
    required this.effectiveVipSource,
    required this.earnedVipLevel,
    required this.adminGrantVipLevel,
    this.trialVipLevel = 0,
    required this.growthPoints,
    required this.maintenancePoints,
    required this.maintenanceRequired,
    required this.currentThreshold,
    required this.remainingToNext,
    required this.maxGrowthPoints,
    required this.earnedVipExpiresAtMs,
    required this.adminGrantExpiresAtMs,
    this.trialVipExpiresAtMs = 0,
    required this.coins,
    required this.purchaseGrowthPerCoin,
    required this.paidRechargeGrowthPerCoin,
    this.canHideRankingLists = false,
    this.hideRankingLists = false,
    this.canHideProfileVisits = false,
    this.hideProfileVisits = false,
    this.canUseFriendsOnlyMessages = false,
    this.friendsOnlyMessages = false,
    this.canHideNobleLevel = false,
    this.hideNobleLevel = false,
    this.canHideGameWinBanner = false,
    this.hideGameWinBanner = false,
    this.canHideBetWinNotification = false,
    this.hideBetWinNotification = false,
    this.canCustomizeVipFrame = false,
    this.vipProfileFrameLevel = 0,
    this.frameCustomizationChangedAtMs = 0,
    this.nextFrameCustomizationAtMs = 0,
    this.policy,
  });

  final int effectiveVipLevel;
  final String effectiveVipSource;
  final int earnedVipLevel;
  final int adminGrantVipLevel;
  final int trialVipLevel;
  final int growthPoints;
  final int maintenancePoints;
  final int maintenanceRequired;
  final int currentThreshold;
  final int remainingToNext;
  final int maxGrowthPoints;
  final int earnedVipExpiresAtMs;
  final int adminGrantExpiresAtMs;
  final int trialVipExpiresAtMs;
  final int coins;
  final int purchaseGrowthPerCoin;
  final int paidRechargeGrowthPerCoin;
  final bool canHideRankingLists;
  final bool hideRankingLists;
  final bool canHideProfileVisits;
  final bool hideProfileVisits;
  final bool canUseFriendsOnlyMessages;
  final bool friendsOnlyMessages;
  final bool canHideNobleLevel;
  final bool hideNobleLevel;
  final bool canHideGameWinBanner;
  final bool hideGameWinBanner;
  final bool canHideBetWinNotification;
  final bool hideBetWinNotification;
  final bool canCustomizeVipFrame;
  final int vipProfileFrameLevel;
  final int frameCustomizationChangedAtMs;
  final int nextFrameCustomizationAtMs;
  final VipPolicyData? policy;

  factory VipSummaryData.fromJson(Map<String, dynamic> json) {
    int value(String key) {
      final raw = json[key];
      if (raw is num) return raw.toInt();
      return int.tryParse(raw?.toString() ?? '') ?? 0;
    }

    return VipSummaryData(
      effectiveVipLevel: value('effectiveVipLevel').clamp(0, 10).toInt(),
      effectiveVipSource:
          (json['effectiveVipSource'] ?? 'none').toString().trim(),
      earnedVipLevel: value('earnedVipLevel').clamp(0, 10).toInt(),
      adminGrantVipLevel: value('adminGrantVipLevel').clamp(0, 10).toInt(),
      trialVipLevel: value('trialVipLevel').clamp(0, 10).toInt(),
      growthPoints: value('growthPoints'),
      maintenancePoints: value('maintenancePoints'),
      maintenanceRequired: value('maintenanceRequired'),
      currentThreshold: value('currentThreshold'),
      remainingToNext: value('remainingToNext'),
      maxGrowthPoints: value('maxGrowthPoints'),
      earnedVipExpiresAtMs: value('earnedVipExpiresAtMs'),
      adminGrantExpiresAtMs: value('adminGrantExpiresAtMs'),
      trialVipExpiresAtMs: value('trialVipExpiresAtMs'),
      coins: value('coins'),
      purchaseGrowthPerCoin: value('purchaseGrowthPerCoin'),
      paidRechargeGrowthPerCoin: value('paidRechargeGrowthPerCoin'),
      canHideRankingLists: json['canHideRankingLists'] == true,
      hideRankingLists: json['hideRankingLists'] == true,
      canHideProfileVisits: json['canHideProfileVisits'] == true,
      hideProfileVisits: json['hideProfileVisits'] == true,
      canUseFriendsOnlyMessages: json['canUseFriendsOnlyMessages'] == true,
      friendsOnlyMessages: json['friendsOnlyMessages'] == true,
      canHideNobleLevel: json['canHideNobleLevel'] == true,
      hideNobleLevel: json['hideNobleLevel'] == true,
      canHideGameWinBanner: json['canHideGameWinBanner'] == true,
      hideGameWinBanner: json['hideGameWinBanner'] == true,
      canHideBetWinNotification: json['canHideBetWinNotification'] == true,
      hideBetWinNotification: json['hideBetWinNotification'] == true,
      canCustomizeVipFrame: json['canCustomizeVipFrame'] == true,
      vipProfileFrameLevel: value('vipProfileFrameLevel').clamp(0, 10).toInt(),
      frameCustomizationChangedAtMs: value('frameCustomizationChangedAtMs'),
      nextFrameCustomizationAtMs: value('nextFrameCustomizationAtMs'),
      policy: json['policy'] is Map
          ? VipPolicyData.fromJson(
              Map<String, dynamic>.from(json['policy'] as Map),
            )
          : null,
    );
  }

  VipSummaryData copyWith({
    int? trialVipLevel,
    int? trialVipExpiresAtMs,
    bool? canHideRankingLists,
    bool? hideRankingLists,
    bool? canHideProfileVisits,
    bool? hideProfileVisits,
    bool? canUseFriendsOnlyMessages,
    bool? friendsOnlyMessages,
    bool? canHideNobleLevel,
    bool? hideNobleLevel,
    bool? canHideGameWinBanner,
    bool? hideGameWinBanner,
    bool? canHideBetWinNotification,
    bool? hideBetWinNotification,
    bool? canCustomizeVipFrame,
    int? vipProfileFrameLevel,
    int? frameCustomizationChangedAtMs,
    int? nextFrameCustomizationAtMs,
    VipPolicyData? policy,
  }) {
    return VipSummaryData(
      effectiveVipLevel: effectiveVipLevel,
      effectiveVipSource: effectiveVipSource,
      earnedVipLevel: earnedVipLevel,
      adminGrantVipLevel: adminGrantVipLevel,
      trialVipLevel: trialVipLevel ?? this.trialVipLevel,
      growthPoints: growthPoints,
      maintenancePoints: maintenancePoints,
      maintenanceRequired: maintenanceRequired,
      currentThreshold: currentThreshold,
      remainingToNext: remainingToNext,
      maxGrowthPoints: maxGrowthPoints,
      earnedVipExpiresAtMs: earnedVipExpiresAtMs,
      adminGrantExpiresAtMs: adminGrantExpiresAtMs,
      trialVipExpiresAtMs:
          trialVipExpiresAtMs ?? this.trialVipExpiresAtMs,
      coins: coins,
      purchaseGrowthPerCoin: purchaseGrowthPerCoin,
      paidRechargeGrowthPerCoin: paidRechargeGrowthPerCoin,
      canHideRankingLists:
          canHideRankingLists ?? this.canHideRankingLists,
      hideRankingLists: hideRankingLists ?? this.hideRankingLists,
      canHideProfileVisits:
          canHideProfileVisits ?? this.canHideProfileVisits,
      hideProfileVisits: hideProfileVisits ?? this.hideProfileVisits,
      canUseFriendsOnlyMessages:
          canUseFriendsOnlyMessages ?? this.canUseFriendsOnlyMessages,
      friendsOnlyMessages:
          friendsOnlyMessages ?? this.friendsOnlyMessages,
      canHideNobleLevel: canHideNobleLevel ?? this.canHideNobleLevel,
      hideNobleLevel: hideNobleLevel ?? this.hideNobleLevel,
      canHideGameWinBanner:
          canHideGameWinBanner ?? this.canHideGameWinBanner,
      hideGameWinBanner: hideGameWinBanner ?? this.hideGameWinBanner,
      canHideBetWinNotification:
          canHideBetWinNotification ?? this.canHideBetWinNotification,
      hideBetWinNotification:
          hideBetWinNotification ?? this.hideBetWinNotification,
      canCustomizeVipFrame:
          canCustomizeVipFrame ?? this.canCustomizeVipFrame,
      vipProfileFrameLevel:
          vipProfileFrameLevel ?? this.vipProfileFrameLevel,
      frameCustomizationChangedAtMs:
          frameCustomizationChangedAtMs ?? this.frameCustomizationChangedAtMs,
      nextFrameCustomizationAtMs:
          nextFrameCustomizationAtMs ?? this.nextFrameCustomizationAtMs,
      policy: policy ?? this.policy,
    );
  }
}

class VipHideListsState {
  const VipHideListsState({
    required this.hideRankingLists,
    required this.canHideRankingLists,
    required this.requiredVipLevel,
  });

  final bool hideRankingLists;
  final bool canHideRankingLists;
  final int requiredVipLevel;

  factory VipHideListsState.fromJson(Map<String, dynamic> json) =>
      VipHideListsState(
        hideRankingLists: json['hideRankingLists'] == true,
        canHideRankingLists: json['canHideRankingLists'] == true,
        requiredVipLevel: (json['requiredVipLevel'] as num?)?.toInt() ?? 7,
      );
}

class VipHideProfileVisitsState {
  const VipHideProfileVisitsState({
    required this.hideProfileVisits,
    required this.canHideProfileVisits,
    required this.requiredVipLevel,
  });

  final bool hideProfileVisits;
  final bool canHideProfileVisits;
  final int requiredVipLevel;

  factory VipHideProfileVisitsState.fromJson(Map<String, dynamic> json) =>
      VipHideProfileVisitsState(
        hideProfileVisits: json['hideProfileVisits'] == true,
        canHideProfileVisits: json['canHideProfileVisits'] == true,
        requiredVipLevel: (json['requiredVipLevel'] as num?)?.toInt() ?? 9,
      );
}

class VipFriendsOnlyMessagesState {
  const VipFriendsOnlyMessagesState({
    required this.friendsOnlyMessages,
    required this.canUseFriendsOnlyMessages,
    required this.requiredVipLevel,
  });

  final bool friendsOnlyMessages;
  final bool canUseFriendsOnlyMessages;
  final int requiredVipLevel;

  factory VipFriendsOnlyMessagesState.fromJson(Map<String, dynamic> json) =>
      VipFriendsOnlyMessagesState(
        friendsOnlyMessages: json['friendsOnlyMessages'] == true,
        canUseFriendsOnlyMessages:
            json['canUseFriendsOnlyMessages'] == true,
        requiredVipLevel: (json['requiredVipLevel'] as num?)?.toInt() ?? 1,
      );
}

class VipPrivacyPreferenceState {
  const VipPrivacyPreferenceState({
    required this.field,
    required this.enabled,
    required this.canUse,
    required this.requiredVipLevel,
  });

  final String field;
  final bool enabled;
  final bool canUse;
  final int requiredVipLevel;

  factory VipPrivacyPreferenceState.fromJson(Map<String, dynamic> json) =>
      VipPrivacyPreferenceState(
        field: (json['field'] ?? '').toString(),
        enabled: json['enabled'] == true,
        canUse: json['canUse'] == true,
        requiredVipLevel: (json['requiredVipLevel'] as num?)?.toInt() ?? 4,
      );
}

class Vip10GlobalEntryState {
  const Vip10GlobalEntryState({
    required this.eligible,
    required this.effectiveVipLevel,
    required this.alreadyPublished,
    required this.dayKey,
  });

  final bool eligible;
  final int effectiveVipLevel;
  final bool alreadyPublished;
  final String dayKey;

  factory Vip10GlobalEntryState.fromJson(Map<String, dynamic> json) =>
      Vip10GlobalEntryState(
        eligible: json['eligible'] == true,
        effectiveVipLevel:
            (json['effectiveVipLevel'] as num?)?.toInt() ?? 0,
        alreadyPublished: json['alreadyPublished'] == true,
        dayKey: (json['dayKey'] ?? '').toString(),
      );
}

class VipFrameCustomizationState {
  const VipFrameCustomizationState({
    required this.vipProfileFrameLevel,
    required this.frameCustomizationChangedAtMs,
    required this.nextFrameCustomizationAtMs,
    required this.effectiveVipLevel,
  });

  final int vipProfileFrameLevel;
  final int frameCustomizationChangedAtMs;
  final int nextFrameCustomizationAtMs;
  final int effectiveVipLevel;

  factory VipFrameCustomizationState.fromJson(Map<String, dynamic> json) {
    int value(String key) {
      final raw = json[key];
      if (raw is num) return raw.toInt();
      return int.tryParse(raw?.toString() ?? '') ?? 0;
    }

    return VipFrameCustomizationState(
      vipProfileFrameLevel: value('vipProfileFrameLevel').clamp(0, 10).toInt(),
      frameCustomizationChangedAtMs: value('frameCustomizationChangedAtMs'),
      nextFrameCustomizationAtMs: value('nextFrameCustomizationAtMs'),
      effectiveVipLevel: value('effectiveVipLevel').clamp(0, 10).toInt(),
    );
  }
}

class VipTrialCard {
  const VipTrialCard({
    required this.cardId,
    required this.vipLevel,
    required this.durationDays,
    required this.source,
    required this.originalOwnerUid,
  });

  final String cardId;
  final int vipLevel;
  final int durationDays;
  final String source;
  final String originalOwnerUid;

  factory VipTrialCard.fromJson(Map<String, dynamic> json) => VipTrialCard(
        cardId: (json['cardId'] ?? '').toString(),
        vipLevel: (json['vipLevel'] as num?)?.toInt() ?? 5,
        durationDays: (json['durationDays'] as num?)?.toInt() ?? 7,
        source: (json['source'] ?? '').toString(),
        originalOwnerUid: (json['originalOwnerUid'] ?? '').toString(),
      );
}

class VipTrialRedeemState {
  const VipTrialRedeemState({
    required this.trialVipLevel,
    required this.trialVipExpiresAtMs,
    required this.effectiveVipLevel,
    required this.effectiveVipSource,
  });

  final int trialVipLevel;
  final int trialVipExpiresAtMs;
  final int effectiveVipLevel;
  final String effectiveVipSource;

  factory VipTrialRedeemState.fromJson(Map<String, dynamic> json) {
    int value(String key) {
      final raw = json[key];
      if (raw is num) return raw.toInt();
      return int.tryParse(raw?.toString() ?? '') ?? 0;
    }

    return VipTrialRedeemState(
      trialVipLevel: value('trialVipLevel'),
      trialVipExpiresAtMs: value('trialVipExpiresAtMs'),
      effectiveVipLevel: value('effectiveVipLevel'),
      effectiveVipSource: (json['effectiveVipSource'] ?? '').toString(),
    );
  }
}

class VipService {
  VipService({
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

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final token = await _token();
    final response = await _client.post(
      Uri.parse('$_baseUrl/vip'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(payload),
    );
    Map<String, dynamic> body = const {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'vip_request_failed').toString());
    }
    return body;
  }

  Future<VipSummaryData> loadSummary() async {
    return VipSummaryData.fromJson(await _post({'action': 'summary'}));
  }

  Future<VipSummaryData> buyGrowth({
    required int growthPoints,
    required String idempotencyKey,
  }) async {
    final body = await _post({
      'action': 'buyGrowth',
      'growthPoints': growthPoints,
      'idempotencyKey': idempotencyKey,
    });
    final vip = body['vip'];
    if (vip is! Map) throw const FormatException('invalid_vip_summary');
    return VipSummaryData.fromJson(Map<String, dynamic>.from(vip));
  }

  Future<VipHistoryPage> loadHistory({
    String? cursor,
    int pageSize = 20,
  }) async {
    final body = await _post({
      'action': 'history',
      'pageSize': pageSize.clamp(1, 20),
      if (cursor != null && cursor.trim().isNotEmpty) 'cursor': cursor.trim(),
    });
    return VipHistoryPage.fromJson(body);
  }


  Future<VipHideListsState> setHideRankingLists(bool enabled) async {
    final body = await _post({
      'action': 'setHideRankingLists',
      'enabled': enabled,
    });
    return VipHideListsState.fromJson(body);
  }

  Future<VipHideProfileVisitsState> setHideProfileVisits(bool enabled) async {
    final body = await _post({
      'action': 'setHideProfileVisits',
      'enabled': enabled,
    });
    return VipHideProfileVisitsState.fromJson(body);
  }

  Future<VipFriendsOnlyMessagesState> setFriendsOnlyMessages(
    bool enabled,
  ) async {
    final body = await _post({
      'action': 'setFriendsOnlyMessages',
      'enabled': enabled,
    });
    return VipFriendsOnlyMessagesState.fromJson(body);
  }

  Future<VipPrivacyPreferenceState> setVip4PrivacyPreference({
    required String field,
    required bool enabled,
  }) async {
    final body = await _post({
      'action': 'setVip4PrivacyPreference',
      'field': field,
      'enabled': enabled,
    });
    return VipPrivacyPreferenceState.fromJson(body);
  }

  Future<Vip10GlobalEntryState> loadVip10GlobalEntryState() async {
    return Vip10GlobalEntryState.fromJson(
      await _post({'action': 'vip10GlobalEntryState'}),
    );
  }

  Future<Vip10GlobalEntryState> publishVip10GlobalEntry() async {
    return Vip10GlobalEntryState.fromJson(
      await _post({'action': 'publishVip10GlobalEntry'}),
    );
  }

  Future<VipFrameCustomizationState> setVipProfileFrame(int frameLevel) async {
    final body = await _post({
      'action': 'setVipProfileFrame',
      'frameLevel': frameLevel,
    });
    return VipFrameCustomizationState.fromJson(body);
  }

  Future<List<VipTrialCard>> listTrialCards() async {
    final body = await _post({'action': 'listTrialCards'});
    final raw = body['cards'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((item) => VipTrialCard.fromJson(
              Map<String, dynamic>.from(item),
            ))
        .where((card) => card.cardId.isNotEmpty)
        .toList(growable: false);
  }

  Future<void> giftTrialCard({
    required String cardId,
    required String recipientUid,
  }) async {
    await _post({
      'action': 'giftTrialCard',
      'cardId': cardId,
      'recipientUid': recipientUid,
    });
  }

  Future<VipTrialRedeemState> redeemTrialCard(String cardId) async {
    return VipTrialRedeemState.fromJson(
      await _post({
        'action': 'redeemTrialCard',
        'cardId': cardId,
      }),
    );
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
