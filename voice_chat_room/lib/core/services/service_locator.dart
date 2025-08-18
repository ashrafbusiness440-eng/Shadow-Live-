import 'package:get_it/get_it.dart';
import '../utils/app_logger.dart';
import 'agora_service.dart';
import 'analytics_service.dart';
import 'firebase_service.dart';
import 'navigation_service.dart';
import 'notification_service.dart';
import 'storage_service.dart';
import 'theme_service.dart';

class ServiceLocator {
  static final ServiceLocator _instance = ServiceLocator._internal();
  factory ServiceLocator() => _instance;
  ServiceLocator._internal();

  final GetIt _locator = GetIt.instance;

  // Initialize all services
  Future<void> initialize() async {
    try {
      // Register services as singletons
      _locator.registerLazySingleton(() => AgoraService());
      _locator.registerLazySingleton(() => AnalyticsService());
      _locator.registerLazySingleton(() => FirebaseService());
      _locator.registerLazySingleton(() => NavigationService());
      _locator.registerLazySingleton(() => NotificationService());
      _locator.registerLazySingleton(() => StorageService());
      _locator.registerLazySingleton(() => ThemeService());

      // Initialize services that require async initialization
      await Future.wait([
        _locator<StorageService>().initialize(),
        _locator<AnalyticsService>().initialize(),
        _locator<NotificationService>().initialize(),
        _locator<ThemeService>().initialize(),
      ]);

      AppLogger.i('Service locator initialized', tag: 'ServiceLocator');
    } catch (e, stackTrace) {
      AppLogger.e(
        'Service locator initialization error',
        tag: 'ServiceLocator',
        error: e,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  // Get a registered service
  T get<T extends Object>() {
    try {
      return _locator<T>();
    } catch (e) {
      AppLogger.e(
        'Error getting service: ${T.toString()}',
        tag: 'ServiceLocator',
        error: e,
      );
      rethrow;
    }
  }

  // Register a new service
  void register<T extends Object>(T instance) {
    try {
      if (_locator.isRegistered<T>()) {
        _locator.unregister<T>();
      }
      _locator.registerSingleton<T>(instance);
      AppLogger.i(
        'Service registered: ${T.toString()}',
        tag: 'ServiceLocator',
      );
    } catch (e) {
      AppLogger.e(
        'Error registering service: ${T.toString()}',
        tag: 'ServiceLocator',
        error: e,
      );
      rethrow;
    }
  }

  // Unregister a service
  void unregister<T extends Object>() {
    try {
      if (_locator.isRegistered<T>()) {
        _locator.unregister<T>();
        AppLogger.i(
          'Service unregistered: ${T.toString()}',
          tag: 'ServiceLocator',
        );
      }
    } catch (e) {
      AppLogger.e(
        'Error unregistering service: ${T.toString()}',
        tag: 'ServiceLocator',
        error: e,
      );
      rethrow;
    }
  }

  // Check if a service is registered
  bool isRegistered<T extends Object>() {
    try {
      return _locator.isRegistered<T>();
    } catch (e) {
      AppLogger.e(
        'Error checking service registration: ${T.toString()}',
        tag: 'ServiceLocator',
        error: e,
      );
      return false;
    }
  }

  // Reset all services
  Future<void> reset() async {
    try {
      _locator.reset();
      await initialize();
      AppLogger.i('Service locator reset', tag: 'ServiceLocator');
    } catch (e) {
      AppLogger.e(
        'Error resetting service locator',
        tag: 'ServiceLocator',
        error: e,
      );
      rethrow;
    }
  }
}