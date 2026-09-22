import 'dart:developer' as developer;
import 'package:flutter/foundation.dart';
import '../enums/app_enums.dart';

class AppLogger {
  static const String _tag = 'VoiceChatRoom';
  static bool _enabled = true;
  static LogLevel _minLevel = LogLevel.debug;

  // Enable or disable logging
  static void enable() => _enabled = true;
  static void disable() => _enabled = false;

  // Set minimum log level
  static void setMinLevel(LogLevel level) => _minLevel = level;

  // Debug level logging
  static void d(String message, {String? tag, StackTrace? stackTrace}) {
    _log(
      message,
      LogLevel.debug,
      tag: tag,
      stackTrace: stackTrace,
    );
  }

  // Info level logging
  static void i(String message, {String? tag, StackTrace? stackTrace}) {
    _log(
      message,
      LogLevel.info,
      tag: tag,
      stackTrace: stackTrace,
    );
  }

  // Warning level logging
  static void w(String message, {String? tag, StackTrace? stackTrace}) {
    _log(
      message,
      LogLevel.warning,
      tag: tag,
      stackTrace: stackTrace,
    );
  }

  // Error level logging
  static void e(String message, {String? tag, Object? error, StackTrace? stackTrace}) {
    _log(
      message,
      LogLevel.error,
      tag: tag,
      error: error,
      stackTrace: stackTrace,
    );
  }

  // Critical level logging
  static void c(String message, {String? tag, Object? error, StackTrace? stackTrace}) {
    _log(
      message,
      LogLevel.critical,
      tag: tag,
      error: error,
      stackTrace: stackTrace,
    );
  }

  // Main logging function
  static void _log(
    String message,
    LogLevel level, {
    String? tag,
    Object? error,
    StackTrace? stackTrace,
  }) {
    if (!_enabled || level.index < _minLevel.index) return;

    final now = DateTime.now();
    final timeString = '${now.hour}:${now.minute}:${now.second}.${now.millisecond}';
    final finalTag = tag ?? _tag;
    final levelString = level.toString().split('.').last.toUpperCase();

    // Build log message
    final buffer = StringBuffer()
      ..write('[$timeString]')
      ..write('[$levelString]')
      ..write('[$finalTag] ')
      ..write(message);

    if (error != null) {
      buffer.write('\nError: $error');
    }

    if (stackTrace != null) {
      buffer.write('\nStack Trace:\n$stackTrace');
    }

    final logMessage = buffer.toString();

    // Log based on environment and level
    if (kDebugMode) {
      switch (level) {
        case LogLevel.debug:
          developer.log(logMessage, name: finalTag);
          break;
        case LogLevel.info:
          developer.log(logMessage, name: finalTag);
          break;
        case LogLevel.warning:
          developer.log(logMessage, name: finalTag, level: 900);
          break;
        case LogLevel.error:
          developer.log(logMessage, name: finalTag, level: 1000, error: error);
          break;
        case LogLevel.critical:
          developer.log(logMessage, name: finalTag, level: 2000, error: error);
          break;
      }
    } else {
      // In release mode, only log warnings and above
      if (level.index >= LogLevel.warning.index) {
        // Here you might want to implement production logging
        // For example, sending logs to a remote service
        _logToService(level, logMessage, error, stackTrace);
      }
    }
  }

  // Method to log to a remote service in production
  static void _logToService(
    LogLevel level,
    String message,
    Object? error,
    StackTrace? stackTrace,
  ) {
    // TODO: Implement remote logging service
    // Example:
    // final logData = {
    //   'level': level.toString(),
    //   'message': message,
    //   'error': error?.toString(),
    //   'stackTrace': stackTrace?.toString(),
    //   'timestamp': DateTime.now().toIso8601String(),
    // };
    // RemoteLoggingService.send(logData);
  }

  // Helper method to log method entry
  static void logMethodEntry(String methodName, {String? className}) {
    if (!_enabled || LogLevel.debug.index < _minLevel.index) return;

    final location = className != null ? '$className.$methodName' : methodName;
    d('Entering $location', tag: 'MethodTrace');
  }

  // Helper method to log method exit
  static void logMethodExit(String methodName, {String? className, dynamic result}) {
    if (!_enabled || LogLevel.debug.index < _minLevel.index) return;

    final location = className != null ? '$className.$methodName' : methodName;
    final message = result != null
        ? 'Exiting $location with result: $result'
        : 'Exiting $location';
    d(message, tag: 'MethodTrace');
  }

  // Helper method to log API calls
  static void logApiCall(String endpoint, {
    String? method,
    Map<String, dynamic>? parameters,
    dynamic response,
    Object? error,
  }) {
    if (!_enabled || LogLevel.debug.index < _minLevel.index) return;

    final buffer = StringBuffer()
      ..write('API Call: $endpoint\n')
      ..write('Method: ${method ?? 'GET'}\n');

    if (parameters != null) {
      buffer.write('Parameters: $parameters\n');
    }

    if (response != null) {
      buffer.write('Response: $response');
    }

    if (error != null) {
      e(buffer.toString(), tag: 'API', error: error);
    } else {
      d(buffer.toString(), tag: 'API');
    }
  }

  // Helper method to log performance metrics
  static void logPerformance(String operation, Duration duration) {
    if (!_enabled || LogLevel.debug.index < _minLevel.index) return;

    d(
      'Performance: $operation took ${duration.inMilliseconds}ms',
      tag: 'Performance',
    );
  }

  // Helper method to log user actions
  static void logUserAction(String action, {Map<String, dynamic>? data}) {
    if (!_enabled || LogLevel.info.index < _minLevel.index) return;

    final message = StringBuffer()
      ..write('User Action: $action');

    if (data != null) {
      message.write('\nData: $data');
    }

    i(message.toString(), tag: 'UserAction');
  }

  // Helper method to log errors with context
  static void logError(String context, Object error, StackTrace? stackTrace) {
    e(
      'Error in $context',
      tag: 'ErrorHandler',
      error: error,
      stackTrace: stackTrace,
    );
  }
}