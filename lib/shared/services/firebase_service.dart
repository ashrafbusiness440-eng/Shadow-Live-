import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

class FirebaseService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseStorage _storage = FirebaseStorage.instance;

  // Authentication Methods
  Future<UserCredential> signInWithEmail(String email, String password) async {
    try {
      return await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
    } catch (e) {
      throw _handleAuthError(e);
    }
  }

  Future<UserCredential> signUpWithEmail(String email, String password) async {
    try {
      return await _auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
    } catch (e) {
      throw _handleAuthError(e);
    }
  }

  Future<void> signOut() async {
    await _auth.signOut();
  }

  Future<void> resetPassword(String email) async {
    try {
      await _auth.sendPasswordResetEmail(email: email);
    } catch (e) {
      throw _handleAuthError(e);
    }
  }

  // User Profile Methods
  Future<void> createUserProfile(String userId, Map<String, dynamic> data) async {
    try {
      await _firestore.collection('users').doc(userId).set(data);
    } catch (e) {
      throw Exception('Failed to create user profile: $e');
    }
  }

  Future<Map<String, dynamic>?> getUserProfile(String userId) async {
    try {
      final doc = await _firestore.collection('users').doc(userId).get();
      return doc.data();
    } catch (e) {
      throw Exception('Failed to get user profile: $e');
    }
  }

  Future<void> updateUserProfile(String userId, Map<String, dynamic> data) async {
    try {
      await _firestore.collection('users').doc(userId).update(data);
    } catch (e) {
      throw Exception('Failed to update user profile: $e');
    }
  }

  // Room Methods
  Future<String> createRoom(Map<String, dynamic> roomData) async {
    try {
      final docRef = await _firestore.collection('rooms').add(roomData);
      return docRef.id;
    } catch (e) {
      throw Exception('Failed to create room: $e');
    }
  }

  Stream<QuerySnapshot> getRooms() {
    return _firestore.collection('rooms')
        .where('isActive', isEqualTo: true)
        .orderBy('createdAt', descending: true)
        .snapshots();
  }

  Future<void> updateRoom(String roomId, Map<String, dynamic> data) async {
    try {
      await _firestore.collection('rooms').doc(roomId).update(data);
    } catch (e) {
      throw Exception('Failed to update room: $e');
    }
  }

  // Storage Methods
  Future<String> uploadFile(String path, List<int> data) async {
    try {
      final ref = _storage.ref().child(path);
      await ref.putData(data);
      return await ref.getDownloadURL();
    } catch (e) {
      throw Exception('Failed to upload file: $e');
    }
  }

  Future<void> deleteFile(String path) async {
    try {
      await _storage.ref().child(path).delete();
    } catch (e) {
      throw Exception('Failed to delete file: $e');
    }
  }

  // Error Handling
  Exception _handleAuthError(dynamic e) {
    if (e is FirebaseAuthException) {
      switch (e.code) {
        case 'user-not-found':
          return Exception('No user found with this email');
        case 'wrong-password':
          return Exception('Wrong password');
        case 'email-already-in-use':
          return Exception('Email is already registered');
        case 'invalid-email':
          return Exception('Invalid email address');
        case 'weak-password':
          return Exception('Password is too weak');
        default:
          return Exception('Authentication failed: ${e.message}');
      }
    }
    return Exception('Authentication failed: $e');
  }
}