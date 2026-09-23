import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../chat/screens/private_chat_screen.dart';

abstract final class ProfileActionService {
  static String conversationId(String a, String b) {
    final ids = [a, b]..sort();
    return ids.join('_');
  }

  static Future<String> _ensureConversation({
    required String me,
    required String otherUid,
  }) async {
    final id = conversationId(me, otherUid);
    final ref = FirebaseFirestore.instance.collection('conversations').doc(id);

    var exists = false;
    try {
      final existing = await ref.get();
      exists = existing.exists;
    } on FirebaseException catch (error) {
      // With participant-only Firestore reads, a GET for a document that does
      // not exist can surface as permission-denied. In that case we proceed
      // with the permitted create below. Any other error should still surface.
      if (error.code != 'permission-denied') rethrow;
    }

    if (!exists) {
      final participants = [me, otherUid]..sort();
      await ref.set({
        'participants': participants,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'unreadCounts': {me: 0, otherUid: 0},
      });
    }

    try {
      await FirebaseFirestore.instance
          .collection('conversation_hides')
          .doc(me)
          .collection('items')
          .doc(id)
          .delete();
    } catch (_) {}

    return id;
  }

  static Future<void> openChat(
    BuildContext context, {
    required String otherUid,
    required String otherName,
    String otherPhoto = '',
  }) {
    final navigator = Navigator.of(context);
    return openChatWithNavigator(
      navigator,
      otherUid: otherUid,
      otherName: otherName,
      otherPhoto: otherPhoto,
    );
  }

  static Future<void> openChatWithNavigator(
    NavigatorState navigator, {
    required String otherUid,
    required String otherName,
    String otherPhoto = '',
  }) async {
    final me = FirebaseAuth.instance.currentUser?.uid;
    if (me == null || me.isEmpty || me == otherUid) return;

    try {
      final id = await _ensureConversation(me: me, otherUid: otherUid);
      if (!navigator.mounted) return;
      await navigator.push(
        MaterialPageRoute(
          builder: (_) => PrivateChatScreen(
            conversationId: id,
            otherUid: otherUid,
            otherName: otherName,
            otherPhoto: otherPhoto,
          ),
        ),
      );
    } catch (_) {
      if (!navigator.mounted) return;
      ScaffoldMessenger.maybeOf(navigator.context)?.showSnackBar(
        const SnackBar(content: Text('تعذر فتح المحادثة')),
      );
    }
  }
}
