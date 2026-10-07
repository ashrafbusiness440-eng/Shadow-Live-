import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Diary gifts open DirectGiftSheet directly without legacy sheet', () {
    final sheet = File(
      'lib/features/gift/widgets/direct_gift_sheet.dart',
    ).readAsStringSync();
    final diarySheet = File(
      'lib/features/diaries/widgets/diary_gifts_sheet.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();

    expect(sheet.contains('String? diaryId'), isTrue);
    expect(sheet.contains("if (diaryId.isEmpty) 'conversationId'"), isTrue);
    expect(sheet.contains("if (diaryId.isNotEmpty) 'diaryId'"), isTrue);
    expect(sheet.contains('onGiftSent?.call'), isTrue);

    expect(diarySheet.contains('listGiftEvents'), isTrue);
    expect(diarySheet.contains('showDirectGiftSheet'), isTrue);
    expect(diarySheet.contains('FirebaseFirestore'), isFalse);
    expect(diarySheet.contains("diaryId: widget.diary.diaryId"), isTrue);

    expect(screen.contains('showDirectGiftSheet('), isTrue);
    expect(screen.contains('diaryId: item.diaryId'), isTrue);
    expect(screen.contains('DiaryGiftsSheet('), isFalse);
    expect(screen.contains("widgets/diary_gifts_sheet.dart"), isFalse);
    expect(screen.contains('giftCoins: current.giftCoins + paidCost'), isTrue);
  });

  test('Diary gift backend keeps one financial path and diary context', () {
    final source = File(
      'cloudflare-worker/src/chat-safety-actions.js',
    ).readAsStringSync();
    final diaries = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();
    final rules = File('firestore.rules').readAsStringSync();
    final agencyShare = File(
      'cloudflare-worker/src/agency-target-share.js',
    ).readAsStringSync();

    expect(source.contains('const contextType = diaryId ? "diary" : "chat";'), isTrue);
    expect(source.contains('invalid_diary_receiver'), isTrue);
    expect(source.contains('...financialContext'), isTrue);
    expect(source.contains('db.increment("giftCount", quantity)'), isTrue);
    expect(source.contains('db.increment("giftCoins", paidCost)'), isTrue);
    expect(
      source.contains(r'const diaryPath = diaryId ? `diaries/${diaryId}` : "";'),
      isTrue,
    );
    expect(source.contains(r'${diaryPath}/gifts/${key}'), isTrue);

    expect(diaries.contains('async function listGiftEvents('), isTrue);
    expect(diaries.contains('limit: limit + 1'), isTrue);
    expect(diaries.contains('.list('), isFalse);
    expect(rules.contains('match /gifts/{giftEventId}'), isTrue);

    expect(agencyShare.contains('diaryId = null'), isTrue);
    expect(agencyShare.contains('diaryId: clean(diaryId) || null'), isTrue);
    expect(
      agencyShare.contains('contextType: clean(contextType) || null'),
      isTrue,
    );
  });
}
