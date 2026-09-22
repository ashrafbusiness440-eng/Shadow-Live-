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
  AuthException(super.message, {super.code, super.details});
}

class SignInException extends AuthException {
  SignInException(super.message, {super.code, super.details});
}

class SignUpException extends AuthException {
  SignUpException(super.message, {super.code, super.details});
}

class SignOutException extends AuthException {
  SignOutException(super.message, {super.code, super.details});
}

class PasswordResetException extends AuthException {
  PasswordResetException(super.message, {super.code, super.details});
}

// Network Exceptions
class NetworkException extends AppException {
  NetworkException(super.message, {super.code, super.details});
}

class ConnectionException extends NetworkException {
  ConnectionException(super.message, {super.code, super.details});
}

class TimeoutException extends NetworkException {
  TimeoutException(super.message, {super.code, super.details});
}

class ServerException extends NetworkException {
  ServerException(super.message, {super.code, super.details});
}

// Room Exceptions
class RoomException extends AppException {
  RoomException(super.message, {super.code, super.details});
}

class RoomCreateException extends RoomException {
  RoomCreateException(super.message, {super.code, super.details});
}

class RoomJoinException extends RoomException {
  RoomJoinException(super.message, {super.code, super.details});
}

class RoomLeaveException extends RoomException {
  RoomLeaveException(super.message, {super.code, super.details});
}

// Voice Chat Exceptions
class VoiceChatException extends AppException {
  VoiceChatException(super.message, {super.code, super.details});
}

class MicrophoneException extends VoiceChatException {
  MicrophoneException(super.message, {super.code, super.details});
}

class AudioException extends VoiceChatException {
  AudioException(super.message, {super.code, super.details});
}

// Gift Exceptions
class GiftException extends AppException {
  GiftException(super.message, {super.code, super.details});
}

class GiftSendException extends GiftException {
  GiftSendException(super.message, {super.code, super.details});
}

class GiftReceiveException extends GiftException {
  GiftReceiveException(super.message, {super.code, super.details});
}

// Payment Exceptions
class PaymentException extends AppException {
  PaymentException(super.message, {super.code, super.details});
}

class PaymentProcessException extends PaymentException {
  PaymentProcessException(super.message, {super.code, super.details});
}

class PaymentVerificationException extends PaymentException {
  PaymentVerificationException(super.message, {super.code, super.details});
}

// Storage Exceptions
class StorageException extends AppException {
  StorageException(super.message, {super.code, super.details});
}

class FileUploadException extends StorageException {
  FileUploadException(super.message, {super.code, super.details});
}

class FileDownloadException extends StorageException {
  FileDownloadException(super.message, {super.code, super.details});
}

// Validation Exceptions
class ValidationException extends AppException {
  ValidationException(super.message, {super.code, super.details});
}

class InputValidationException extends ValidationException {
  InputValidationException(super.message, {super.code, super.details});
}

class DataValidationException extends ValidationException {
  DataValidationException(super.message, {super.code, super.details});
}

// Permission Exceptions
class PermissionException extends AppException {
  PermissionException(super.message, {super.code, super.details});
}

class DevicePermissionException extends PermissionException {
  DevicePermissionException(super.message, {super.code, super.details});
}

class RolePermissionException extends PermissionException {
  RolePermissionException(super.message, {super.code, super.details});
}

// Cache Exceptions
class CacheException extends AppException {
  CacheException(super.message, {super.code, super.details});
}

class CacheReadException extends CacheException {
  CacheReadException(super.message, {super.code, super.details});
}

class CacheWriteException extends CacheException {
  CacheWriteException(super.message, {super.code, super.details});
}

// Configuration Exceptions
class ConfigException extends AppException {
  ConfigException(super.message, {super.code, super.details});
}

class ConfigLoadException extends ConfigException {
  ConfigLoadException(super.message, {super.code, super.details});
}

class ConfigUpdateException extends ConfigException {
  ConfigUpdateException(super.message, {super.code, super.details});
}
