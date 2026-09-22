import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../shared/services/firebase_service.dart';

// Events
abstract class GiftEvent {}

class LoadGiftList extends GiftEvent {}

class SendGift extends GiftEvent {
  final String senderId;
  final String receiverId;
  final String giftId;
  final int quantity;
  final int totalCost;

  SendGift({
    required this.senderId,
    required this.receiverId,
    required this.giftId,
    required this.quantity,
    required this.totalCost,
  });
}

class LoadGiftHistory extends GiftEvent {
  final String userId;
  final String type; // 'sent' or 'received'

  LoadGiftHistory(this.userId, this.type);
}

class LoadRoomGifts extends GiftEvent {
  final String roomId;

  LoadRoomGifts(this.roomId);
}

// States
abstract class GiftState {}

class GiftInitial extends GiftState {}

class GiftLoading extends GiftState {}

class GiftListLoaded extends GiftState {
  final List<Map<String, dynamic>> gifts;

  GiftListLoaded(this.gifts);
}

class GiftSent extends GiftState {
  final Map<String, dynamic> transaction;

  GiftSent(this.transaction);
}

class GiftHistoryLoaded extends GiftState {
  final List<Map<String, dynamic>> history;

  GiftHistoryLoaded(this.history);
}

class RoomGiftsLoaded extends GiftState {
  final List<Map<String, dynamic>> gifts;
  final Map<String, int> giftCounts;

  RoomGiftsLoaded(this.gifts, this.giftCounts);
}

class GiftError extends GiftState {
  final String message;

  GiftError(this.message);
}

// Bloc
class GiftBloc extends Bloc<GiftEvent, GiftState> {
  final FirebaseService _firebaseService;

  GiftBloc(this._firebaseService) : super(GiftInitial()) {
    on<LoadGiftList>(_onLoadGiftList);
    on<SendGift>(_onSendGift);
    on<LoadGiftHistory>(_onLoadGiftHistory);
    on<LoadRoomGifts>(_onLoadRoomGifts);
  }

  Future<void> _onLoadGiftList(
    LoadGiftList event,
    Emitter<GiftState> emit,
  ) async {
    emit(GiftLoading());
    try {
      final giftsSnapshot = await _firebaseService
          .getCollection('gifts')
          .where('isActive', isEqualTo: true)
          .orderBy('price')
          .get();

      final gifts = giftsSnapshot.docs
          .map((doc) => {'id': doc.id, ...doc.data()})
          .toList();

      emit(GiftListLoaded(gifts));
    } catch (e) {
      emit(GiftError(e.toString()));
    }
  }

  Future<void> _onSendGift(
    SendGift event,
    Emitter<GiftState> emit,
  ) async {
    emit(GiftLoading());
    try {
      // Create gift transaction
      final transaction = {
        'senderId': event.senderId,
        'receiverId': event.receiverId,
        'giftId': event.giftId,
        'quantity': event.quantity,
        'totalCost': event.totalCost,
        'timestamp': DateTime.now().toIso8601String(),
      };

      // Add transaction to Firestore
      final docRef = await _firebaseService
          .getCollection('gift_transactions')
          .add(transaction);

      // Update sender's balance
      await _firebaseService.updateUserProfile(
        event.senderId,
        {
          'balance': FieldValue.increment(-event.totalCost),
          'totalGiftsSent': FieldValue.increment(event.quantity),
        },
      );

      // Update receiver's stats
      await _firebaseService.updateUserProfile(
        event.receiverId,
        {
          'totalGiftsReceived': FieldValue.increment(event.quantity),
          'totalValueReceived': FieldValue.increment(event.totalCost),
        },
      );

      emit(GiftSent({'id': docRef.id, ...transaction}));
    } catch (e) {
      emit(GiftError(e.toString()));
    }
  }

  Future<void> _onLoadGiftHistory(
    LoadGiftHistory event,
    Emitter<GiftState> emit,
  ) async {
    emit(GiftLoading());
    try {
      final query = _firebaseService
          .getCollection('gift_transactions')
          .where(event.type == 'sent' ? 'senderId' : 'receiverId', isEqualTo: event.userId)
          .orderBy('timestamp', descending: true)
          .limit(50);

      final snapshot = await query.get();
      final history = snapshot.docs
          .map((doc) => {'id': doc.id, ...doc.data()})
          .toList();

      emit(GiftHistoryLoaded(history));
    } catch (e) {
      emit(GiftError(e.toString()));
    }
  }

  Future<void> _onLoadRoomGifts(
    LoadRoomGifts event,
    Emitter<GiftState> emit,
  ) async {
    emit(GiftLoading());
    try {
      final snapshot = await _firebaseService
          .getCollection('gift_transactions')
          .where('roomId', isEqualTo: event.roomId)
          .orderBy('timestamp', descending: true)
          .limit(100)
          .get();

      final gifts = snapshot.docs
          .map((doc) => {'id': doc.id, ...doc.data()})
          .toList();

      // Calculate gift counts
      final giftCounts = <String, int>{};
      for (var gift in gifts) {
        final giftId = gift['giftId'] as String;
        giftCounts[giftId] = (giftCounts[giftId] ?? 0) + (gift['quantity'] as int);
      }

      emit(RoomGiftsLoaded(gifts, giftCounts));
    } catch (e) {
      emit(GiftError(e.toString()));
    }
  }
}