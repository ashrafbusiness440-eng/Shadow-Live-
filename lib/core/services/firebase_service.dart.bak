import 'dart:io';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import '../constants/app_constants.dart';
import '../utils/app_logger.dart';
import '../exceptions/app_exceptions.dart';

class FirebaseService {
  static final FirebaseService _instance = FirebaseService._internal();
  factory FirebaseService() => _instance;
  FirebaseService._internal();

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseStorage _storage = FirebaseStorage.instance;

  // Authentication Methods
  Future<UserCredential> signInWithEmailAndPassword(
    String email,
    String password,
  ) async {
    try {
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      AppLogger.i('User signed in: ${userCredential.user?.uid}', tag: 'Auth');
      return userCredential;
    } catch (e) {
      AppLogger.e('Sign in error', tag: 'Auth', error: e);
      throw AuthException('Failed to sign in: ${e.toString()}');
    }
  }

  Future<UserCredential> createUserWithEmailAndPassword(
    String email,
    String password,
  ) async {
    try {
      final userCredential = await _auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      AppLogger.i('User created: ${userCredential.user?.uid}', tag: 'Auth');
      return userCredential;
    } catch (e) {
      AppLogger.e('Sign up error', tag: 'Auth', error: e);
      throw AuthException('Failed to create user: ${e.toString()}');
    }
  }

  Future<void> signOut() async {
    try {
      await _auth.signOut();
      AppLogger.i('User signed out', tag: 'Auth');
    } catch (e) {
      AppLogger.e('Sign out error', tag: 'Auth', error: e);
      throw AuthException('Failed to sign out: ${e.toString()}');
    }
  }

  // User Profile Methods
  Future<void> createUserProfile(String userId, Map<String, dynamic> data) async {
    try {
      await _firestore.collection('users').doc(userId).set(data);
      AppLogger.i('User profile created: $userId', tag: 'Firestore');
    } catch (e) {
      AppLogger.e('Create profile error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to create profile: ${e.toString()}');
    }
  }

  Future<Map<String, dynamic>?> getUserProfile(String userId) async {
    try {
      final doc = await _firestore.collection('users').doc(userId).get();
      AppLogger.i('User profile retrieved: $userId', tag: 'Firestore');
      return doc.data();
    } catch (e) {
      AppLogger.e('Get profile error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to get profile: ${e.toString()}');
    }
  }

  Future<void> updateUserProfile(
    String userId,
    Map<String, dynamic> data,
  ) async {
    try {
      await _firestore.collection('users').doc(userId).update(data);
      AppLogger.i('User profile updated: $userId', tag: 'Firestore');
    } catch (e) {
      AppLogger.e('Update profile error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to update profile: ${e.toString()}');
    }
  }

  // Room Methods
  Future<String> createRoom(Map<String, dynamic> roomData) async {
    try {
      final docRef = await _firestore.collection('rooms').add(roomData);
      AppLogger.i('Room created: ${docRef.id}', tag: 'Firestore');
      return docRef.id;
    } catch (e) {
      AppLogger.e('Create room error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to create room: ${e.toString()}');
    }
  }

  Future<void> updateRoom(String roomId, Map<String, dynamic> data) async {
    try {
      await _firestore.collection('rooms').doc(roomId).update(data);
      AppLogger.i('Room updated: $roomId', tag: 'Firestore');
    } catch (e) {
      AppLogger.e('Update room error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to update room: ${e.toString()}');
    }
  }

  Future<void> deleteRoom(String roomId) async {
    try {
      await _firestore.collection('rooms').doc(roomId).delete();
      AppLogger.i('Room deleted: $roomId', tag: 'Firestore');
    } catch (e) {
      AppLogger.e('Delete room error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to delete room: ${e.toString()}');
    }
  }

  Stream<QuerySnapshot> getRoomList() {
    try {
      return _firestore
          .collection('rooms')
          .where('status', isEqualTo: 'active')
          .snapshots();
    } catch (e) {
      AppLogger.e('Get room list error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to get room list: ${e.toString()}');
    }
  }

  Stream<DocumentSnapshot> getRoomStream(String roomId) {
    try {
      return _firestore.collection('rooms').doc(roomId).snapshots();
    } catch (e) {
      AppLogger.e('Get room stream error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to get room stream: ${e.toString()}');
    }
  }

  // Gift Methods
  Future<void> sendGift(
    String fromUserId,
    String toUserId,
    String roomId,
    Map<String, dynamic> giftData,
  ) async {
    try {
      final batch = _firestore.batch();

      // Create gift transaction
      final giftRef = _firestore.collection('gifts').doc();
      batch.set(giftRef, {
        ...giftData,
        'fromUserId': fromUserId,
        'toUserId': toUserId,
        'roomId': roomId,
        'timestamp': FieldValue.serverTimestamp(),
      });

      // Update sender's balance
      final senderRef = _firestore.collection('users').doc(fromUserId);
      batch.update(senderRef, {
        'balance': FieldValue.increment(-giftData['cost']),
      });

      // Update receiver's balance
      final receiverRef = _firestore.collection('users').doc(toUserId);
      batch.update(receiverRef, {
        'receivedGifts': FieldValue.increment(1),
        'earnings': FieldValue.increment(giftData['value']),
      });

      await batch.commit();
      AppLogger.i('Gift sent: ${giftRef.id}', tag: 'Firestore');
    } catch (e) {
      AppLogger.e('Send gift error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to send gift: ${e.toString()}');
    }
  }

  Stream<QuerySnapshot> getGiftHistory(String userId) {
    try {
      return _firestore
          .collection('gifts')
          .where('toUserId', isEqualTo: userId)
          .orderBy('timestamp', descending: true)
          .limit(50)
          .snapshots();
    } catch (e) {
      AppLogger.e('Get gift history error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to get gift history: ${e.toString()}');
    }
  }

  // Storage Methods
  Future<String> uploadFile(
    String path,
    File file, {
    void Function(double)? onProgress,
  }) async {
    try {
      final ref = _storage.ref().child(path);
      final uploadTask = ref.putFile(file);

      if (onProgress != null) {
        uploadTask.snapshotEvents.listen((TaskSnapshot snapshot) {
          final progress = snapshot.bytesTransferred / snapshot.totalBytes;
          onProgress(progress);
        });
      }

      final snapshot = await uploadTask;
      final downloadUrl = await snapshot.ref.getDownloadURL();
      AppLogger.i('File uploaded: $path', tag: 'Storage');
      return downloadUrl;
    } catch (e) {
      AppLogger.e('Upload file error', tag: 'Storage', error: e);
      throw StorageException('Failed to upload file: ${e.toString()}');
    }
  }

  Future<void> deleteFile(String path) async {
    try {
      final ref = _storage.ref().child(path);
      await ref.delete();
      AppLogger.i('File deleted: $path', tag: 'Storage');
    } catch (e) {
      AppLogger.e('Delete file error', tag: 'Storage', error: e);
      throw StorageException('Failed to delete file: ${e.toString()}');
    }
  }

  // VIP Methods
  Future<void> updateVipStatus(
    String userId,
    int level,
    DateTime expiryDate,
  ) async {
    try {
      await _firestore.collection('users').doc(userId).update({
        'vipLevel': level,
        'vipExpiryDate': expiryDate.toIso8601String(),
      });
      AppLogger.i('VIP status updated: $userId', tag: 'Firestore');
    } catch (e) {
      AppLogger.e('Update VIP status error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to update VIP status: ${e.toString()}');
    }
  }

  // Follow Methods
  Future<void> followUser(String followerId, String followingId) async {
    try {
      final batch = _firestore.batch();

      // Update follower's following list
      final followerRef = _firestore.collection('users').doc(followerId);
      batch.update(followerRef, {
        'following': FieldValue.arrayUnion([followingId]),
        'followingCount': FieldValue.increment(1),
      });

      // Update following's followers list
      final followingRef = _firestore.collection('users').doc(followingId);
      batch.update(followingRef, {
        'followers': FieldValue.arrayUnion([followerId]),
        'followerCount': FieldValue.increment(1),
      });

      await batch.commit();
      AppLogger.i(
        'Follow relationship created: $followerId -> $followingId',
        tag: 'Firestore',
      );
    } catch (e) {
      AppLogger.e('Follow user error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to follow user: ${e.toString()}');
    }
  }

  Future<void> unfollowUser(String followerId, String followingId) async {
    try {
      final batch = _firestore.batch();

      // Update follower's following list
      final followerRef = _firestore.collection('users').doc(followerId);
      batch.update(followerRef, {
        'following': FieldValue.arrayRemove([followingId]),
        'followingCount': FieldValue.increment(-1),
      });

      // Update following's followers list
      final followingRef = _firestore.collection('users').doc(followingId);
      batch.update(followingRef, {
        'followers': FieldValue.arrayRemove([followerId]),
        'followerCount': FieldValue.increment(-1),
      });

      await batch.commit();
      AppLogger.i(
        'Follow relationship removed: $followerId -> $followingId',
        tag: 'Firestore',
      );
    } catch (e) {
      AppLogger.e('Unfollow user error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to unfollow user: ${e.toString()}');
    }
  }

  // Notification Methods
  Future<void> sendNotification(
    String userId,
    Map<String, dynamic> notificationData,
  ) async {
    try {
      await _firestore.collection('notifications').add({
        ...notificationData,
        'userId': userId,
        'timestamp': FieldValue.serverTimestamp(),
        'read': false,
      });
      AppLogger.i('Notification sent to: $userId', tag: 'Firestore');
    } catch (e) {
      AppLogger.e('Send notification error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to send notification: ${e.toString()}');
    }
  }

  Stream<QuerySnapshot> getNotifications(String userId) {
    try {
      return _firestore
          .collection('notifications')
          .where('userId', isEqualTo: userId)
          .orderBy('timestamp', descending: true)
          .limit(50)
          .snapshots();
    } catch (e) {
      AppLogger.e('Get notifications error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to get notifications: ${e.toString()}');
    }
  }

  // Achievement Methods
  Future<void> unlockAchievement(
    String userId,
    String achievementId,
  ) async {
    try {
      await _firestore.collection('achievements').add({
        'userId': userId,
        'achievementId': achievementId,
        'unlockedAt': FieldValue.serverTimestamp(),
      });
      AppLogger.i(
        'Achievement unlocked: $userId - $achievementId',
        tag: 'Firestore',
      );
    } catch (e) {
      AppLogger.e('Unlock achievement error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to unlock achievement: ${e.toString()}');
    }
  }

  // PK Battle Methods
  Future<void> createPKBattle(
    String roomId,
    String hostId,
    String challengerId,
    Map<String, dynamic> battleData,
  ) async {
    try {
      await _firestore.collection('pkBattles').add({
        ...battleData,
        'roomId': roomId,
        'hostId': hostId,
        'challengerId': challengerId,
        'startTime': FieldValue.serverTimestamp(),
        'status': 'active',
      });
      AppLogger.i('PK battle created in room: $roomId', tag: 'Firestore');
    } catch (e) {
      AppLogger.e('Create PK battle error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to create PK battle: ${e.toString()}');
    }
  }

  Stream<QuerySnapshot> getPKBattleStream(String roomId) {
    try {
      return _firestore
          .collection('pkBattles')
          .where('roomId', isEqualTo: roomId)
          .where('status', isEqualTo: 'active')
          .snapshots();
    } catch (e) {
      AppLogger.e('Get PK battle stream error', tag: 'Firestore', error: e);
      throw FirestoreException('Failed to get PK battle stream: ${e.toString()}');
    }
  }
}