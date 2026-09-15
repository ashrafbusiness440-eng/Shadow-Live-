import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter/foundation.dart';
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

class GoogleSignInRequested extends AuthEvent {}

class AppleSignInRequested extends AuthEvent {}

class GuestSignInRequested extends AuthEvent {}

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
  ConfirmationResult? _webConfirmationResult;

  AuthBloc(this._firebaseService, this._storageService) : super(AuthInitial()) {
    on<AuthCheckRequested>(_onAuthCheckRequested);
    on<SignInRequested>(_onSignInRequested);
    on<SignUpRequested>(_onSignUpRequested);
    on<PhoneAuthRequested>(_onPhoneAuthRequested);
    on<PhoneCodeSubmitted>(_onPhoneCodeSubmitted);
    on<GoogleSignInRequested>(_onGoogleSignInRequested);
    on<AppleSignInRequested>(_onAppleSignInRequested);
    on<GuestSignInRequested>(_onGuestSignInRequested);
    on<SignOutRequested>(_onSignOutRequested);
  }

  Future<void> _onAuthCheckRequested(
      AuthCheckRequested event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    try {
      final currentUser = FirebaseAuth.instance.currentUser;
      if (currentUser != null) {
        var userData = await _firebaseService.getUserProfile(currentUser.uid);

        if (userData == null) {
          userData = {
            'uid': currentUser.uid,
            'email': currentUser.email ?? '',
            'phone': currentUser.phoneNumber ?? '',
            'username': currentUser.displayName ?? '',
            'role': 'user',
            'coins': 0,
            'diamonds': 0,
            'balance': 0,
            'vipLevel': 0,
            'isOnline': true,
            'createdAt': DateTime.now().toIso8601String(),
            'lastLogin': DateTime.now().toIso8601String(),
          };

          await _firebaseService.createUserProfile(
            currentUser.uid,
            userData,
          );
        }

        await _storageService.saveUser(userData);
        emit(Authenticated(currentUser, userData));
      } else {
        emit(Unauthenticated());
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onAppleSignInRequested(
      AppleSignInRequested event, Emitter<AuthState> emit) async {
    emit(AuthLoading());

    try {
      final provider = OAuthProvider('apple.com');

      provider.addScope('email');
      provider.addScope('name');

      final UserCredential credential;

      if (kIsWeb) {
        credential = await FirebaseAuth.instance.signInWithPopup(provider);
      } else {
        credential = await FirebaseAuth.instance.signInWithProvider(provider);
      }

      final user = credential.user;

      if (user == null) {
        emit(Unauthenticated());
        return;
      }

      var userData = await _firebaseService.getUserProfile(user.uid);

      if (userData == null) {
        userData = {
          'uid': user.uid,
          'email': user.email ?? '',
          'phone': user.phoneNumber ?? '',
          'username': '',
          'displayName': user.displayName ?? '',
          'photoUrl': user.photoURL ?? '',
          'role': 'user',
          'coins': 0,
          'diamonds': 0,
          'balance': 0,
          'vipLevel': 0,
          'isOnline': true,
          'setupStep': 'profile',
          'setupComplete': false,
          'createdAt': DateTime.now().toIso8601String(),
          'lastLogin': DateTime.now().toIso8601String(),
        };

        await _firebaseService.createUserProfile(user.uid, userData);
      }

      await _storageService.saveUser(userData);
      emit(Authenticated(user, userData));
    } on FirebaseAuthException catch (e) {
      if (e.code == 'popup-closed-by-user' ||
          e.code == 'cancelled-popup-request') {
        emit(Unauthenticated());
      } else {
        emit(AuthError('Apple: ${e.message ?? e.code}'));
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onGoogleSignInRequested(
      GoogleSignInRequested event, Emitter<AuthState> emit) async {
    emit(AuthLoading());

    try {
      final provider = GoogleAuthProvider();
      provider.setCustomParameters({'prompt': 'select_account'});

      final UserCredential credential;

      if (kIsWeb) {
        credential = await FirebaseAuth.instance.signInWithPopup(provider);
      } else {
        credential = await FirebaseAuth.instance.signInWithProvider(provider);
      }

      final user = credential.user;

      if (user == null) {
        emit(Unauthenticated());
        return;
      }

      var userData = await _firebaseService.getUserProfile(user.uid);

      if (userData == null) {
        userData = {
          'uid': user.uid,
          'email': user.email ?? '',
          'phone': user.phoneNumber ?? '',
          'username': '',
          'displayName': user.displayName ?? '',
          'photoUrl': user.photoURL ?? '',
          'role': 'user',
          'coins': 0,
          'diamonds': 0,
          'balance': 0,
          'vipLevel': 0,
          'isOnline': true,
          'setupStep': 'profile',
          'setupComplete': false,
          'createdAt': DateTime.now().toIso8601String(),
          'lastLogin': DateTime.now().toIso8601String(),
        };

        await _firebaseService.createUserProfile(user.uid, userData);
      }

      await _storageService.saveUser(userData);
      emit(Authenticated(user, userData));
    } on FirebaseAuthException catch (e) {
      if (e.code == 'popup-closed-by-user' ||
          e.code == 'cancelled-popup-request') {
        emit(Unauthenticated());
      } else {
        emit(AuthError('Google: ${e.message ?? e.code}'));
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onSignInRequested(
      SignInRequested event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    try {
      final userCredential = await _firebaseService.signInWithEmail(
        event.email,
        event.password,
      );

      if (userCredential.user != null) {
        final user = userCredential.user!;
        var userData = await _firebaseService.getUserProfile(user.uid);

        if (userData == null) {
          userData = {
            'uid': user.uid,
            'email': user.email ?? event.email,
            'phone': user.phoneNumber ?? '',
            'username': user.displayName ?? '',
            'role': 'user',
            'coins': 0,
            'diamonds': 0,
            'balance': 0,
            'vipLevel': 0,
            'isOnline': true,
            'createdAt': DateTime.now().toIso8601String(),
            'lastLogin': DateTime.now().toIso8601String(),
          };

          await _firebaseService.createUserProfile(
            user.uid,
            userData,
          );
        }

        await _storageService.saveUser(userData);
        emit(Authenticated(user, userData));
      } else {
        emit(Unauthenticated());
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onSignUpRequested(
      SignUpRequested event, Emitter<AuthState> emit) async {
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
          'uid': userCredential.user!.uid,
          'email': event.email,
          'role': event.userData['role'] ?? 'user',
          'coins': event.userData['coins'] ?? 0,
          'diamonds': event.userData['diamonds'] ?? 0,
          'createdAt': DateTime.now().toIso8601String(),
          'lastLogin': DateTime.now().toIso8601String(),
        };

        await _firebaseService.createUserProfile(
            userCredential.user!.uid, userData);
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

    try {
      if (kIsWeb) {
        _webConfirmationResult =
            await FirebaseAuth.instance.signInWithPhoneNumber(
          event.phoneNumber,
        );

        emit(PhoneCodeSent('web'));
        return;
      }

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
                  'uid': uid,
                  'phone': event.phoneNumber,
                  'role': 'user',
                  'coins': 0,
                  'diamonds': 0,
                  'setupStep': 'profile',
                  'setupComplete': false,
                  'createdAt': DateTime.now().toIso8601String(),
                  'lastLogin': DateTime.now().toIso8601String(),
                };

                await _firebaseService.createUserProfile(uid, userData);
              }

              await _storageService.saveUser(userData);
              emit(Authenticated(userCredential.user!, userData));
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
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onPhoneCodeSubmitted(
    PhoneCodeSubmitted event,
    Emitter<AuthState> emit,
  ) async {
    emit(AuthLoading());

    try {
      UserCredential userCredential;

      if (kIsWeb) {
        final confirmationResult = _webConfirmationResult;

        if (confirmationResult == null) {
          emit(AuthError('انتهت جلسة التحقق، أعد إرسال الرمز'));
          return;
        }

        userCredential = await confirmationResult.confirm(event.smsCode);
      } else {
        userCredential = await _firebaseService.signInWithPhoneCode(
          verificationId: event.verificationId,
          smsCode: event.smsCode,
        );
      }

      if (userCredential.user != null) {
        final uid = userCredential.user!.uid;
        var userData = await _firebaseService.getUserProfile(uid);

        if (userData == null) {
          userData = {
            'uid': uid,
            'phone': userCredential.user!.phoneNumber ?? '',
            'role': 'user',
            'coins': 0,
            'diamonds': 0,
            'setupStep': 'profile',
            'setupComplete': false,
            'createdAt': DateTime.now().toIso8601String(),
            'lastLogin': DateTime.now().toIso8601String(),
          };

          await _firebaseService.createUserProfile(uid, userData);
        }

        await _storageService.saveUser(userData);
        emit(Authenticated(userCredential.user!, userData));
      }
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onGuestSignInRequested(
    GuestSignInRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(AuthLoading());
    try {
      final credential = await _firebaseService.signInAnonymously();
      final user = credential.user;

      if (user == null) {
        emit(AuthError('تعذر إنشاء جلسة الضيف'));
        return;
      }

      final userData = <String, dynamic>{
        'uid': user.uid,
        'username': 'ضيف',
        'role': 'guest',
        'coins': 0,
        'diamonds': 0,
        'balance': 0,
        'vipLevel': 0,
        'isOnline': true,
        'isGuest': true,
        'createdAt': DateTime.now().toIso8601String(),
        'lastLogin': DateTime.now().toIso8601String(),
      };

      emit(Authenticated(user, userData));
    } catch (e) {
      emit(AuthError(e.toString()));
    }
  }

  Future<void> _onSignOutRequested(
      SignOutRequested event, Emitter<AuthState> emit) async {
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
