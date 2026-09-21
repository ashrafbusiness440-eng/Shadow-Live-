import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../chat/screens/private_chat_screen.dart';

abstract final class ProfileActionService {
  static String conversationId(String a, String b) {
    final ids = [a, b]..sort();
    return ids.join('_');
  }

  static Future<void> openChat(
    BuildContext context, {
    required String otherUid,
    required String otherName,
    String otherPhoto = '',
  }) async {
    final me = FirebaseAuth.instance.currentUser?.uid;
    if (me == null || me.isEmpty || me == otherUid) return;

    final id = conversationId(me, otherUid);
    final ref = FirebaseFirestore.instance.collection('conversations').doc(id);
    final existing = await ref.get();
    if (!existing.exists) {
      await ref.set({
        'participants': [me, otherUid],
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'unreadCounts': {me: 0, otherUid: 0},
      });
    }

    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PrivateChatScreen(
          conversationId: id,
          otherUid: otherUid,
          otherName: otherName,
          otherPhoto: otherPhoto,
        ),
      ),
    );
  }
}
