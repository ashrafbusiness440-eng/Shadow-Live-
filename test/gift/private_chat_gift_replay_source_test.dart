import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final chat = File('lib/features/chat/screens/private_chat_screen.dart')
      .readAsStringSync();
  final direct = File('lib/features/gift/widgets/direct_gift_sheet.dart')
      .readAsStringSync();
  final picker = File('lib/features/gift/widgets/unified_gift_picker_sheet.dart')
      .readAsStringSync();

  test('both chat participants can tap stored gifts to replay without sending', () {
    expect(chat, contains("onTap: type == 'gift' ? () => _playGiftEffect(data, manual: true) : null"));
    expect(chat, contains('if (!_giftEffectStreamReady)'));
    expect(chat, contains('if (now - createdAtMs < 0 || now - createdAtMs > 12000) continue;'));
    final start = chat.indexOf('void _playGiftEffect(');
    final end = chat.indexOf('Widget _giftEffectVisual()', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final manualReplay = chat.substring(start, end);
    expect(manualReplay, contains("message['giftEffectEventId']"));
    expect(manualReplay, contains("message['giftEffectAssetKey']"));
    expect(manualReplay, contains('++_giftEffectPlayCounter'));
    expect(manualReplay, contains('_giftEffectTimer?.cancel()'));
    expect(manualReplay, isNot(contains('widget.onSend(')));
    expect(manualReplay, isNot(contains('RoomGiftService')));
    expect(manualReplay, isNot(contains('updateCachedBalance(')));
    expect(manualReplay, contains('unawaited(_showGiftEffectWhenLoaded('));
    expect(chat, contains('await precacheImage(NetworkImage(url.toString()), context);'));
  });

  test('modal gift animations go above barrier but below gift picker', () {
    expect(direct, contains('onSheetLayout?.call(sheetContext)'));
    expect(direct, contains('onSheetClosed?.call()'));
    expect(chat, contains('onSheetLayout: _layoutGiftSheetEffectOverlay'));
    expect(chat, contains('onSheetClosed: _removeGiftSheetEffectOverlay'));
    expect(chat, contains('overlay.insert(entry, below: route.overlayEntries.last);'));
    expect(chat, contains('height: _giftSheetTop'));
    expect(chat, contains('IgnorePointer('));
    expect(chat, contains('_giftSheetEffectOverlay?.markNeedsBuild()'));
    expect(chat, contains('if (_activeGiftEffect != null &&'));
    expect(chat, contains('_giftSheetEffectOverlay == null)'));
    expect(chat, contains('_giftSheetEffectOverlay?.remove()'));
    expect(chat, isNot(contains('Timer.periodic(')));
  });

  test('private success toast removed, failures preserved and combo haptic strengthened', () {
    expect(direct, contains("message: '',"));
    expect(picker, contains('if (message.isNotEmpty)'));
    expect(picker, contains('ScaffoldMessenger.of(context).showSnackBar('));
    expect(picker, contains('HapticFeedback.heavyImpact();'));
    expect(picker, contains('onPressed: _canCombo'));
    expect(picker, contains('MediaQuery.maybeOf(context)?.disableAnimations'));
    expect(picker, contains('const Duration(seconds: 4)'));
  });
}
