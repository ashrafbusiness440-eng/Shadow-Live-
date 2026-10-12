import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final source =
      File('lib/features/diaries/screens/diaries_screen.dart').readAsStringSync();

  test('diary cards retain live author identity and stable post key', () {
    expect(source.contains("ValueKey('diary-post-card-"), isTrue);
    expect(source.contains("userId: item.ownerUid"), isTrue);
    expect(source.contains("item.ownerProfileImageUrl"), isTrue);
    expect(source.contains("item.ownerProfileAvatarAsset"), isTrue);
    expect(source.contains("item.ownerPublicId.isNotEmpty"), isTrue);
    expect(source.contains("Flexible(\n                              child: Text(\n                                'ID: "), isTrue);
    expect(source.contains("overflow: TextOverflow.ellipsis"), isTrue);
    expect(source.contains("_timeLabel(item.createdAtMs)"), isTrue);
  });

  test('narrow RTL reaction row wraps without dropping any active action', () {
    final begin = source.indexOf('Widget _diaryCard(DiaryItem item)');
    final end = source.indexOf('Widget _networkImages(DiaryItem item)', begin);
    expect(begin, greaterThanOrEqualTo(0));
    expect(end, greaterThan(begin));
    final card = source.substring(begin, end);
    // Regression: the previous unconstrained Wrap/Center expanded every
    // reaction to a separate full-width line on narrow mobile web screens.
    expect(card.contains('Row(\n            children: ['), isTrue);
    expect(card.contains('Wrap(\n            alignment: WrapAlignment.spaceBetween,'), isFalse);
    final strip = card.substring(card.indexOf('// Four equally sized reaction targets:'));
    expect('Expanded('.allMatches(strip).length, 4);
    expect(card.contains('const Spacer()'), isFalse);
    expect(card.contains('onTap: () => _toggleLike(item)'), isTrue);
    expect(card.contains('onTap: () => _openComments(item)'), isTrue);
    expect(card.contains('onTap: () => _openGifts(item)'), isTrue);
    expect(card.contains('item.viewCount'), isTrue);
    expect(source.contains('BoxConstraints(minHeight: 44)'), isTrue);
    expect(card.contains('PopupMenuButton<String>('), isTrue);
  });
}
