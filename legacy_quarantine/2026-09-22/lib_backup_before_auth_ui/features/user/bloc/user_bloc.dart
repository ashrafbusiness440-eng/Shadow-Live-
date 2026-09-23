import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../shared/services/firebase_service.dart';
import '../../../shared/services/storage_service.dart';

// Events
abstract class UserEvent {}

class LoadUserProfile extends UserEvent {
  final String userId;

  LoadUserProfile(this.userId);
}

class UpdateUserProfile extends UserEvent {
  final String userId;
  final Map<String, dynamic> data;

  UpdateUserProfile(this.userId, this.data);
}

class UpdateUserSettings extends UserEvent {
  final Map<String, dynamic> settings;

  UpdateUserSettings(this.settings);
}

class UpdateVipStatus extends UserEvent {
  final String userId;
  final int vipLevel;
  final Map<String, dynamic> vipData;

  UpdateVipStatus(this.userId, this.vipLevel, this.vipData);
}

class UpdateUserBalance extends UserEvent {
  final String userId;
  final int amount;
  final String operation; // 'add' or 'subtract'

  UpdateUserBalance(this.userId, this.amount, this.operation);
}

// States
abstract class UserState {}

class UserInitial extends UserState {}

class UserLoading extends UserState {}

class UserProfileLoaded extends UserState {
  final Map<String, dynamic> profile;
  final Map<String, dynamic> settings;

  UserProfileLoaded(this.profile, this.settings);
}

class UserProfileUpdated extends UserState {
  final Map<String, dynamic> profile;

  UserProfileUpdated(this.profile);
}

class UserError extends UserState {
  final String message;

  UserError(this.message);
}

// Bloc
class UserBloc extends Bloc<UserEvent, UserState> {
  final FirebaseService _firebaseService;
  final StorageService _storageService;

  UserBloc(this._firebaseService, this._storageService) : super(UserInitial()) {
    on<LoadUserProfile>(_onLoadUserProfile);
    on<UpdateUserProfile>(_onUpdateUserProfile);
    on<UpdateUserSettings>(_onUpdateUserSettings);
    on<UpdateVipStatus>(_onUpdateVipStatus);
    on<UpdateUserBalance>(_onUpdateUserBalance);
  }

  Future<void> _onLoadUserProfile(
    LoadUserProfile event,
    Emitter<UserState> emit,
  ) async {
    emit(UserLoading());
    try {
      final profile = await _firebaseService.getUserProfile(event.userId);
      final settings = await _storageService.getSettings();

      if (profile != null) {
        emit(UserProfileLoaded(profile, settings));
      } else {
        emit(UserError('User profile not found'));
      }
    } catch (e) {
      emit(UserError(e.toString()));
    }
  }

  Future<void> _onUpdateUserProfile(
    UpdateUserProfile event,
    Emitter<UserState> emit,
  ) async {
    emit(UserLoading());
    try {
      await _firebaseService.updateUserProfile(event.userId, event.data);
      
      final updatedProfile = await _firebaseService.getUserProfile(event.userId);
      if (updatedProfile != null) {
        await _storageService.saveUser(updatedProfile);
        emit(UserProfileUpdated(updatedProfile));
      } else {
        emit(UserError('Failed to fetch updated profile'));
      }
    } catch (e) {
      emit(UserError(e.toString()));
    }
  }

  Future<void> _onUpdateUserSettings(
    UpdateUserSettings event,
    Emitter<UserState> emit,
  ) async {
    try {
      await _storageService.saveSettings(event.settings);
      
      final profile = await _storageService.getUser();
      final settings = await _storageService.getSettings();
      
      if (profile != null) {
        emit(UserProfileLoaded(profile, settings));
      }
    } catch (e) {
      emit(UserError(e.toString()));
    }
  }

  Future<void> _onUpdateVipStatus(
    UpdateVipStatus event,
    Emitter<UserState> emit,
  ) async {
    emit(UserLoading());
    try {
      final updateData = {
        'vipLevel': event.vipLevel,
        'vipData': event.vipData,
        'vipUpdatedAt': DateTime.now().toIso8601String(),
      };

      await _firebaseService.updateUserProfile(event.userId, updateData);
      
      final updatedProfile = await _firebaseService.getUserProfile(event.userId);
      if (updatedProfile != null) {
        await _storageService.saveUser(updatedProfile);
        emit(UserProfileUpdated(updatedProfile));
      } else {
        emit(UserError('Failed to fetch updated profile'));
      }
    } catch (e) {
      emit(UserError(e.toString()));
    }
  }

  Future<void> _onUpdateUserBalance(
    UpdateUserBalance event,
    Emitter<UserState> emit,
  ) async {
    emit(UserLoading());
    try {
      final profile = await _firebaseService.getUserProfile(event.userId);
      
      if (profile != null) {
        final currentBalance = profile['balance'] as int? ?? 0;
        final newBalance = event.operation == 'add'
            ? currentBalance + event.amount
            : currentBalance - event.amount;

        if (event.operation == 'subtract' && newBalance < 0) {
          emit(UserError('Insufficient balance'));
          return;
        }

        final updateData = {
          'balance': newBalance,
          'lastBalanceUpdate': DateTime.now().toIso8601String(),
        };

        await _firebaseService.updateUserProfile(event.userId, updateData);
        
        final updatedProfile = await _firebaseService.getUserProfile(event.userId);
        if (updatedProfile != null) {
          await _storageService.saveUser(updatedProfile);
          emit(UserProfileUpdated(updatedProfile));
        } else {
          emit(UserError('Failed to fetch updated profile'));
        }
      } else {
        emit(UserError('User profile not found'));
      }
    } catch (e) {
      emit(UserError(e.toString()));
    }
  }
}