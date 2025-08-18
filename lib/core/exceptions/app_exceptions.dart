// Base Exception
abstract class AppException implements Exception {
  final String message;
  final String? code;
  final dynamic details;

  AppException(this.message, {this.code, this.details});

  @override
  String toString() => 'AppException: $message (Code: $code)';
}

// Authentication Exceptions
class AuthException extends AppException {
  AuthException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class SignInException extends AuthException {
  SignInException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class SignUpException extends AuthException {
  SignUpException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class SignOutException extends AuthException {
  SignOutException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class PasswordResetException extends AuthException {
  PasswordResetException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Network Exceptions
class NetworkException extends AppException {
  NetworkException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class ConnectionException extends NetworkException {
  ConnectionException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class TimeoutException extends NetworkException {
  TimeoutException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class ServerException extends NetworkException {
  ServerException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Room Exceptions
class RoomException extends AppException {
  RoomException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class RoomCreateException extends RoomException {
  RoomCreateException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class RoomJoinException extends RoomException {
  RoomJoinException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class RoomLeaveException extends RoomException {
  RoomLeaveException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Voice Chat Exceptions
class VoiceChatException extends AppException {
  VoiceChatException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class MicrophoneException extends VoiceChatException {
  MicrophoneException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class AudioException extends VoiceChatException {
  AudioException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Gift Exceptions
class GiftException extends AppException {
  GiftException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class GiftSendException extends GiftException {
  GiftSendException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class GiftReceiveException extends GiftException {
  GiftReceiveException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Payment Exceptions
class PaymentException extends AppException {
  PaymentException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class PaymentProcessException extends PaymentException {
  PaymentProcessException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class PaymentVerificationException extends PaymentException {
  PaymentVerificationException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Storage Exceptions
class StorageException extends AppException {
  StorageException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class FileUploadException extends StorageException {
  FileUploadException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class FileDownloadException extends StorageException {
  FileDownloadException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Validation Exceptions
class ValidationException extends AppException {
  ValidationException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class InputValidationException extends ValidationException {
  InputValidationException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class DataValidationException extends ValidationException {
  DataValidationException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Permission Exceptions
class PermissionException extends AppException {
  PermissionException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class DevicePermissionException extends PermissionException {
  DevicePermissionException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class RolePermissionException extends PermissionException {
  RolePermissionException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Cache Exceptions
class CacheException extends AppException {
  CacheException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class CacheReadException extends CacheException {
  CacheReadException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class CacheWriteException extends CacheException {
  CacheWriteException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

// Configuration Exceptions
class ConfigException extends AppException {
  ConfigException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class ConfigLoadException extends ConfigException {
  ConfigLoadException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}

class ConfigUpdateException extends ConfigException {
  ConfigUpdateException(String message, {String? code, dynamic details})
      : super(message, code: code, details: details);
}