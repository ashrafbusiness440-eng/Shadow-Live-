/// Native/unsupported fallback. Browser FCM is opt-in and isolated.
bool get supported => false;
String get permission => 'denied';
Future<String?> getToken(String vapidKey) async => null;
Future<void> deleteToken() async {}
Future<void> subscribe(void Function(Map<String, dynamic> data) onMessage) async {}
String? consumeInitialCallId() => null;
