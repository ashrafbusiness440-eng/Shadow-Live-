import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../shared/services/firebase_service.dart';
import '../../../shared/services/storage_service.dart';

// Events
abstract class AuthEvent {}

class AuthCheckRequested extends AuthEvent {}

class SignInRequested extends AuthEvent {
  final String email;
  final String password;

  SignInRequested(this.email, this.password);
}

class SignUpRequested extends AuthEvent {
  final String email;
  final String password;
  final Map<String, dynamic> userData;

  SignUpRequested(this.email, this.password, this.userData);
}


class PhoneAuthRequested extends AuthEvent {
  final String phoneNumber;
  PhoneAuthRequested(this.phoneNumber);
}

class PhoneCodeSubmitted extends AuthEvent {
  final String verificationId;
  final String smsCode;
  PhoneCodeSubmitted(this.verificationId, this.smsCode);
}

class SignOutRequested extends AuthEvent {}

// States
abstract class AuthState {}

class AuthInitial extends AuthState {}

class AuthLoading extends AuthState {}

class Authenticated extends AuthState {
  final User user;
  final Map<String, dynamic>? userData;

  Authenticated(this.user, this.userData);
}


class PhoneCodeSent extends AuthState {
  final String verificationId;
  PhoneCodeSent(this.verificationId);
}

class Unauthenticated extends AuthState {}

class AuthError extends AuthState {
  final String message;

  AuthError(this.message);
}

// Bloc
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  final FirebaseService _firebaseService;
  final StorageService _storageService;

  AuthBloc(this._firebaseService, this._storageService) : super(AuthInitial()) {
    on<AuthCheckRequested>(_onAuthCheckRequested);
    on<SignInRequested>(_onSignInRequested);
    on<SignUpRequested>(_onSignUpRequested);
    on<PhoneAuthRequested>(_onPhoneAuthRequested);
    on<PhoneCodeSubmitted>(_onPhoneCodeSubmitted);
    on<SignOutRequested>(_onSignOutRequested);
  }

  Future<void> _onAuthCheckRequested(AuthCheckRequested event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    try {
      final currentUser = FirebaseAuth.instance.currentUser;
      if (currentUser != null) {
        final userData = await _firebaseService.getUserProfile(currentUser.uid);
        emit(Authenticated(currentUser, userData));
      } else {
        emit(Unauthenticated());
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onSignInRequested(SignInRequested event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    try {
      final userCredential = await _firebaseService.signInWithEmail(
        event.email,
        event.password,
      );
      
      if (userCredential.user != null) {
        final userData = await _firebaseService.getUserProfile(userCredential.user!.uid);
        await _storageService.saveUser(userData ?? {});
        emit(Authenticated(userCredential.user!, userData));
      } else {
        emit(Unauthenticated());
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onSignUpRequested(SignUpRequested event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    try {
      final userCredential = await _firebaseService.signUpWithEmail(
        event.email,
        event.password,
      );

      if (userCredential.user != null) {
        // Create user profile
        final userData = {
          ...event.userData,
          'email': event.email,
          'createdAt': DateTime.now().toIso8601String(),
          'lastLogin': DateTime.now().toIso8601String(),
        };

        await _firebaseService.createUserProfile(userCredential.user!.uid, userData);
        await _storageService.saveUser(userData);
        
        emit(Authenticated(userCredential.user!, userData));
      } else {
        emit(Unauthenticated());
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  
Future<void> _onPhoneAuthRequested(
  PhoneAuthRequested event,
  Emitter<AuthState> emit,
) async {
  emit(AuthLoading());

  await _firebaseService.verifyPhoneNumber(
    phoneNumber: event.phoneNumber,
    verificationCompleted: (credential) async {
      try {
        final userCredential =
            await FirebaseAuth.instance.signInWithCredential(credential);

        if (userCredential.user != null) {
          final uid = userCredential.user!.uid;
          var userData = await _firebaseService.getUserProfile(uid);

          if (userData == null) {
            userData = {
              'phone': event.phoneNumber,
              'createdAt': DateTime.now().toIso8601String(),
              'lastLogin': DateTime.now().toIso8601String(),
            };
            await _firebaseService.createUserProfile(uid, userData);
          }

          await _storageService.saveUser(userData ?? {});
          emit(Authenticated(userCredential.user!, userData ?? {}));
        }
      } catch (e) {
        emit(AuthError(e.toString()));
      }
    },
    verificationFailed: (error) {
      emit(AuthError(error.message ?? error.code));
    },
    codeSent: (verificationId, resendToken) {
      emit(PhoneCodeSent(verificationId));
    },
    codeAutoRetrievalTimeout: (verificationId) {
      emit(PhoneCodeSent(verificationId));
    },
  );
}

Future<void> _onPhoneCodeSubmitted(
  PhoneCodeSubmitted event,
  Emitter<AuthState> emit,
) async {
  emit(AuthLoading());

  try {
    final userCredential =
        await _firebaseService.signInWithPhoneCode(
      verificationId: event.verificationId,
      smsCode: event.smsCode,
    );

    if (userCredential.user != null) {
      final uid = userCredential.user!.uid;
      var userData = await _firebaseService.getUserProfile(uid);

      if (userData == null) {
        userData = {
          'phone': userCredential.user!.phoneNumber ?? '',
          'createdAt': DateTime.now().toIso8601String(),
          'lastLogin': DateTime.now().toIso8601String(),
        };
        await _firebaseService.createUserProfile(uid, userData);
      }

      await _storageService.saveUser(userData ?? {});
      emit(Authenticated(userCredential.user!, userData ?? {}));
    }
  } catch (e) {
    emit(AuthError(e.toString()));
  }
}

Future<void> _onSignOutRequested(SignOutRequested event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    try {
      await _firebaseService.signOut();
      await _storageService.removeUser();
      await _storageService.removeToken();
      emit(Unauthenticated());
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }
}