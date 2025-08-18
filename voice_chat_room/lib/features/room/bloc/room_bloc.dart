import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../shared/services/firebase_service.dart';
import '../../../shared/services/agora_service.dart';

// Events
abstract class RoomEvent {}

class CreateRoomRequested extends RoomEvent {
  final String name;
  final String hostId;
  final Map<String, dynamic> roomData;

  CreateRoomRequested(this.name, this.hostId, this.roomData);
}

class JoinRoomRequested extends RoomEvent {
  final String roomId;
  final String userId;
  final bool asHost;

  JoinRoomRequested(this.roomId, this.userId, {this.asHost = false});
}

class LeaveRoomRequested extends RoomEvent {}

class ToggleMicRequested extends RoomEvent {
  final bool enabled;

  ToggleMicRequested(this.enabled);
}

class UserJoined extends RoomEvent {
  final int uid;

  UserJoined(this.uid);
}

class UserLeft extends RoomEvent {
  final int uid;

  UserLeft(this.uid);
}

class UpdateRoomInfo extends RoomEvent {
  final Map<String, dynamic> roomData;

  UpdateRoomInfo(this.roomData);
}

// States
abstract class RoomState {}

class RoomInitial extends RoomState {}

class RoomLoading extends RoomState {}

class RoomCreated extends RoomState {
  final String roomId;
  final Map<String, dynamic> roomData;

  RoomCreated(this.roomId, this.roomData);
}

class RoomJoined extends RoomState {
  final String roomId;
  final Map<String, dynamic> roomData;
  final List<int> participants;
  final bool isHost;

  RoomJoined(this.roomId, this.roomData, this.participants, this.isHost);
}

class RoomLeft extends RoomState {}

class RoomError extends RoomState {
  final String message;

  RoomError(this.message);
}

// Bloc
class RoomBloc extends Bloc<RoomEvent, RoomState> {
  final FirebaseService _firebaseService;
  final AgoraService _agoraService;
  StreamSubscription? _roomSubscription;
  List<int> _participants = [];
  String? _currentRoomId;
  bool _isHost = false;

  RoomBloc(this._firebaseService, this._agoraService) : super(RoomInitial()) {
    on<CreateRoomRequested>(_onCreateRoomRequested);
    on<JoinRoomRequested>(_onJoinRoomRequested);
    on<LeaveRoomRequested>(_onLeaveRoomRequested);
    on<ToggleMicRequested>(_onToggleMicRequested);
    on<UserJoined>(_onUserJoined);
    on<UserLeft>(_onUserLeft);
    on<UpdateRoomInfo>(_onUpdateRoomInfo);

    // Set up Agora callbacks
    _agoraService.onUserJoined = (uid) => add(UserJoined(uid));
    _agoraService.onUserOffline = (uid, _) => add(UserLeft(uid));
  }

  Future<void> _onCreateRoomRequested(
    CreateRoomRequested event,
    Emitter<RoomState> emit,
  ) async {
    emit(RoomLoading());
    try {
      final roomData = {
        ...event.roomData,
        'name': event.name,
        'hostId': event.hostId,
        'isActive': true,
        'createdAt': DateTime.now().toIso8601String(),
        'participants': [],
      };

      final roomId = await _firebaseService.createRoom(roomData);
      _currentRoomId = roomId;
      _isHost = true;

      // Initialize Agora and join as host
      await _agoraService.initialize();
      await _agoraService.joinChannel(roomId, int.parse(event.hostId), asHost: true);

      emit(RoomCreated(roomId, roomData));
    } catch (e) {
      emit(RoomError(e.toString()));
    }
  }

  Future<void> _onJoinRoomRequested(
    JoinRoomRequested event,
    Emitter<RoomState> emit,
  ) async {
    emit(RoomLoading());
    try {
      // Initialize Agora and join channel
      await _agoraService.initialize();
      await _agoraService.joinChannel(
        event.roomId,
        int.parse(event.userId),
        asHost: event.asHost,
      );

      _currentRoomId = event.roomId;
      _isHost = event.asHost;

      // Update room data in Firestore
      final roomData = {
        'participants': FieldValue.arrayUnion([event.userId]),
      };
      await _firebaseService.updateRoom(event.roomId, roomData);

      emit(RoomJoined(event.roomId, roomData, _participants, event.asHost));
    } catch (e) {
      emit(RoomError(e.toString()));
    }
  }

  Future<void> _onLeaveRoomRequested(
    LeaveRoomRequested event,
    Emitter<RoomState> emit,
  ) async {
    emit(RoomLoading());
    try {
      if (_currentRoomId != null) {
        // Leave Agora channel
        await _agoraService.leaveChannel();

        // Update room data in Firestore
        if (_isHost) {
          await _firebaseService.updateRoom(_currentRoomId!, {'isActive': false});
        }

        _currentRoomId = null;
        _isHost = false;
        _participants.clear();

        emit(RoomLeft());
      }
    } catch (e) {
      emit(RoomError(e.toString()));
    }
  }

  Future<void> _onToggleMicRequested(
    ToggleMicRequested event,
    Emitter<RoomState> emit,
  ) async {
    try {
      await _agoraService.toggleMicrophone(event.enabled);
      if (_currentRoomId != null) {
        emit(RoomJoined(_currentRoomId!, {}, _participants, _isHost));
      }
    } catch (e) {
      emit(RoomError(e.toString()));
    }
  }

  void _onUserJoined(UserJoined event, Emitter<RoomState> emit) {
    _participants.add(event.uid);
    if (_currentRoomId != null) {
      emit(RoomJoined(_currentRoomId!, {}, _participants, _isHost));
    }
  }

  void _onUserLeft(UserLeft event, Emitter<RoomState> emit) {
    _participants.remove(event.uid);
    if (_currentRoomId != null) {
      emit(RoomJoined(_currentRoomId!, {}, _participants, _isHost));
    }
  }

  void _onUpdateRoomInfo(UpdateRoomInfo event, Emitter<RoomState> emit) {
    if (_currentRoomId != null) {
      emit(RoomJoined(_currentRoomId!, event.roomData, _participants, _isHost));
    }
  }

  @override
  Future<void> close() {
    _roomSubscription?.cancel();
    _agoraService.dispose();
    return super.close();
  }
}