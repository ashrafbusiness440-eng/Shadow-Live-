import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('chat image send locks before any async permission or picker work', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    final start = source.indexOf('  Future<void> _sendImage() async {');
    final once = source.indexOf('  Future<void> _sendImageOnce() async {');
    final end = source.indexOf('  Future<int> _selfVipLevel()', once);
    expect(start, greaterThanOrEqualTo(0));
    expect(once, greaterThan(start));
    expect(end, greaterThan(once));
    final wrapper = source.substring(start, once);
    final body = source.substring(once, end);

    expect(wrapper.contains('if (_sendingImage || !mounted) return;'), isTrue);
    expect(wrapper.contains('setState(() => _sendingImage = true);'), isTrue);
    expect(wrapper.contains('await _sendImageOnce();'), isTrue);
    expect(wrapper.contains('if (mounted) setState(() => _sendingImage = false);'), isTrue);
    expect(body.contains('await _follow.isMutual(widget.otherUid)'), isTrue);
    expect(body.contains('await _storageReady()'), isTrue);
    expect(body.contains('_picker.pickImage('), isTrue);
    expect(body.contains('setState(() => _sendingImage = true);'), isFalse,
        reason: 'Do not wait until after image picking to acquire send lock');
  });
}
