import '../../voice/services/voice_room_session_controller.dart';

class RoomChatMessage {
  const RoomChatMessage({
    required this.id,
    required this.type,
    required this.senderUid,
    required this.displayName,
    required this.profileImageUrl,
    this.activeProfileFrameAssetKey = '',
    this.activeProfileFrameImageUrl = '',
    this.activeProfileFrameExpiresAtMs = 0,
    this.activeProfileFramePermanent = false,
    this.publicId = '',
    this.wealthLevel = 0,
    this.attractionLevel = 0,
    this.gameLevel = 0,
    required this.text,
    required this.mentionUids,
    required this.replyTo,
    required this.replyPreview,
    required this.replySenderUid,
    required this.createdAt,
    required this.systemKind,
    required this.vipLevel,
    required this.entryEffectKey,
    required this.vipEmojiToken,
    required this.giftName,
    required this.giftAssetKey,
    required this.giftImageUrl,
    required this.giftQuantity,
    required this.giftTotalCost,
  });

  final String id;
  final String type;
  final String senderUid;
  final String displayName;
  final String profileImageUrl;
  final String activeProfileFrameAssetKey;
  final String activeProfileFrameImageUrl;
  final int activeProfileFrameExpiresAtMs;
  final bool activeProfileFramePermanent;
  final String publicId;
  final int wealthLevel;
  final int attractionLevel;
  final int gameLevel;
  final String text;
  final List<String> mentionUids;
  final String? replyTo;
  final String? replyPreview;
  final String? replySenderUid;
  final DateTime? createdAt;
  final String systemKind;
  final int vipLevel;
  final String entryEffectKey;
  final String vipEmojiToken;
  final String giftName;
  final String giftAssetKey;
  final String giftImageUrl;
  final int giftQuantity;
  final int giftTotalCost;

  factory RoomChatMessage.fromMap(Map<String, dynamic> data) {
    final createdAtMs = (data['createdAtMs'] as num?)?.toInt() ?? 0;
    return RoomChatMessage(
      id: (data['id'] ?? '').toString(),
      type: (data['type'] ?? 'text').toString(),
      senderUid: (data['senderUid'] ?? '').toString(),
      displayName:
          (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
      profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
      activeProfileFrameAssetKey:
          (data['activeProfileFrameAssetKey'] ?? '').toString(),
      activeProfileFrameImageUrl:
          (data['activeProfileFrameImageUrl'] ?? '').toString(),
      activeProfileFrameExpiresAtMs:
          (data['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ?? 0,
      activeProfileFramePermanent:
          data['activeProfileFramePermanent'] == true,
      publicId: (data['publicId'] ?? '').toString(),
      wealthLevel: (data['wealthLevel'] as num?)?.toInt() ?? 0,
      attractionLevel: (data['attractionLevel'] as num?)?.toInt() ?? 0,
      gameLevel: (data['gameLevel'] as num?)?.toInt() ?? 0,
      text: (data['text'] ?? data['systemText'] ?? '').toString(),
      mentionUids: data['mentionUids'] is List
          ? (data['mentionUids'] as List)
              .map((value) => value.toString())
              .toList(growable: false)
          : const [],
      replyTo: data['replyTo']?.toString(),
      replyPreview: data['replyPreview']?.toString(),
      replySenderUid: data['replySenderUid']?.toString(),
      createdAt: createdAtMs > 0
          ? DateTime.fromMillisecondsSinceEpoch(createdAtMs)
          : null,
      systemKind: (data['systemKind'] ?? '').toString(),
      vipLevel: (data['vipLevel'] as num?)?.toInt() ?? 0,
      entryEffectKey: (data['entryEffectKey'] ?? '').toString(),
      vipEmojiToken: (data['vipEmojiToken'] ?? '').toString(),
      giftName: (data['giftName'] ?? '').toString(),
      giftAssetKey: (data['assetKey'] ?? '').toString(),
      giftImageUrl: (data['imageUrl'] ?? '').toString(),
      giftQuantity: (data['quantity'] as num?)?.toInt() ?? 0,
      giftTotalCost: (data['totalCost'] as num?)?.toInt() ?? 0,
    );
  }
}

class RoomChatService {
  RoomChatService({
    VoiceRoomSessionController? session,
  }) : _session = session ?? VoiceRoomSessionController.instance;

  final VoiceRoomSessionController _session;

  Future<void> reportMessage({
    required String roomId,
    required String messageId,
    required String reason,
  }) async {
    final activeRoomId = _session.roomId.trim();
    if (!_session.active ||
        activeRoomId.isEmpty ||
        activeRoomId != roomId.trim()) {
      throw StateError('room_realtime_not_connected');
    }
    await _session.reportRoomChatMessage(
      messageId: messageId,
      reason: reason,
    );
  }

  Future<void> sendMessage({
    required String roomId,
    required String text,
    String? replyTo,
    String? replyPreview,
    String? replySenderUid,
    List<String> mentionUids = const [],
    String? vipEmojiToken,
  }) async {
    final activeRoomId = _session.roomId.trim();
    if (!_session.active ||
        activeRoomId.isEmpty ||
        activeRoomId != roomId.trim()) {
      throw StateError('room_realtime_not_connected');
    }
    await _session.sendRoomChat(
      text: text,
      replyTo: replyTo,
      replyPreview: replyPreview,
      replySenderUid: replySenderUid,
      mentionUids: mentionUids,
      vipEmojiToken: vipEmojiToken,
    );
  }

  void close() {}
}
