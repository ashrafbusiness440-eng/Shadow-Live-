import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('uncertain Firestore commit never deletes R2 bytes that may back a message', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart').readAsStringSync();
    final start = source.indexOf('  Future<void> _sendImageOnce(String senderUid) async');
    final end = source.indexOf('  Future<void> _loadOlderMessages(', start);
    final body = source.substring(start, end);
    expect(body, contains('bool imageCommitAttempted = false;'));
    expect(body, contains('attemptedMessageRef = messageRef;'));
    expect(body, contains('imageCommitAttempted = true;\n      await batch.commit();'));

    for (final handler in <String>[
      '} on FirebaseException catch (error) {',
      '} on StateError catch (error) {',
      '} catch (_) {\n      if (imageCommitAttempted) {',
    ]) {
      expect(body, contains(handler));
    }
    // Every handler checks ambiguity before considering deletion.
    final paths = <String>[
      body.split('} on FirebaseException catch (error) {').last
          .split('} on StateError catch (error) {').first,
      body.split('} on StateError catch (error) {').last
          .split('} catch (_) {').first,
      body.split('} catch (_) {\n      if (imageCommitAttempted) {').last,
    ];
    for (final handler in paths) {
      expect(handler.indexOf('if (imageCommitAttempted)'),
          lessThan(handler.indexOf('await _deleteUploadedObjectQuietly(uploadedObjectId);')));
      expect(handler, contains('return;'));
    }
  });

  test('confirm precisely one image receipt and never assert delivery on missing network acknowledgement', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart').readAsStringSync();
    final start = source.indexOf('Future<void> _reportUncertainImageCommit(');
    final end = source.indexOf('Future<void> _sendImage() async', start);
    final body = source.substring(start, end);
    expect(body, contains('const GetOptions(source: Source.server)'));
    expect(body, contains("data?['senderId'] == senderUid"));
    expect(body, contains("data?['storageObjectId'] == objectId"));
    expect(body, contains("data?['type'] == 'image'"));
    expect(body, contains('_isActiveChatAccount(senderUid)'));
    expect(body, contains('قد تكون وصلت بالفعل'));
    expect(body, isNot(contains('.snapshots()')));
    expect(body, isNot(contains('.where(')));
    expect(body, isNot(contains('Timer.periodic')));
  });

  test('review-pending placeholder checks receipt rather than claiming definite failure', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart').readAsStringSync();
    expect(source, contains('pendingMessageRef = messageRef;'));
    expect(source, contains('pendingMessageRef, senderUid, pending.objectId'));
    expect(source, isNot(contains('تعذر ربط الصورة بالمحادثة. لم يتم نشرها.')));
  });
}
