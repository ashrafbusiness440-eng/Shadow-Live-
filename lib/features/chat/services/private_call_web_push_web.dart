import 'dart:convert';
import 'dart:js_interop';

@JS('shadowPrivateCallWebPush.supported')
external JSBoolean _supported();
@JS('shadowPrivateCallWebPush.permission')
external JSString _permission();
@JS('shadowPrivateCallWebPush.getToken')
external JSPromise<JSString?> _getToken(JSString vapidKey);
@JS('shadowPrivateCallWebPush.deleteToken')
external JSPromise<JSAny?> _deleteToken();
@JS('shadowPrivateCallWebPush.subscribe')
external JSPromise<JSAny?> _subscribe(JSFunction callback);
@JS('shadowPrivateCallWebPush.consumeInitialCallId')
external JSString? _consumeInitialCallId();

bool get supported {
  try {
    return _supported().toDart;
  } catch (_) {
    return false;
  }
}

String get permission {
  try {
    return _permission().toDart;
  } catch (_) {
    return 'denied';
  }
}

Future<String?> getToken(String vapidKey) async =>
    (await _getToken(vapidKey.toJS).toDart)?.toDart;

Future<void> deleteToken() async {
  await _deleteToken().toDart;
}

Future<void> subscribe(
  void Function(Map<String, dynamic> data) onMessage,
) async {
  await _subscribe(((JSString raw) {
    try {
      final decoded = jsonDecode(raw.toDart);
      if (decoded is Map<String, dynamic>) onMessage(decoded);
    } catch (_) {
      // A web push is untrusted: only parsed call pointers are forwarded.
    }
  }).toJS).toDart;
}

String? consumeInitialCallId() => _consumeInitialCallId()?.toDart;
