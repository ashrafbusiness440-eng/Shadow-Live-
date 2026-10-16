import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/chat/services/private_call_signaling_client.dart';

const callId = 'abcdef0123456789abcdef0123456789';

void main() {
  test('start retries use the same operation and resolve server duplicate state',
      () async {
    final actions = <String>[];
    final keys = <String>[];
    final client = PrivateCallSignalingClient(
      currentUid: () => 'alice',
      isAnonymous: () => false,
      idTokenProvider: () async => 'firebase-id-token',
      baseUrl: 'https://example.test/api',
      client: MockClient((request) async {
        expect(request.url.path, '/api/private-call-signaling');
        expect(request.headers['authorization'], 'Bearer firebase-id-token');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        actions.add(body['action'] as String);
        if (body['action'] == 'start') {
          keys.add(body['idempotencyKey'] as String);
          if (keys.length == 1) {
            return http.Response(jsonEncode({
              'ok': true, 'callId': callId, 'status': 'ringing',
              'ringDeadlineMs': 1790000030000,
            }), 200);
          }
          return http.Response(jsonEncode({
            'ok': true, 'callId': callId, 'code': 'duplicate',
          }), 200);
        }
        expect(body['action'], 'get');
        expect(body['callId'], callId);
        return http.Response(jsonEncode({
          'ok': true, 'callId': callId, 'status': 'active',
          'callerUid': 'alice', 'calleeUid': 'bob',
        }), 200);
      }),
    );
    final first = await client.start(
      actorUid: 'alice', otherUid: 'bob',
      conversationId: 'conv1',
      idempotencyKey: 'operation_abcdefgh',
    );
    final retry = await client.start(
      actorUid: 'alice', otherUid: 'bob',
      conversationId: 'conv1',
      idempotencyKey: 'operation_abcdefgh',
    );
    expect(first.status, 'ringing');
    expect(retry.status, 'active');
    expect(keys, ['operation_abcdefgh', 'operation_abcdefgh']);
    expect(actions, ['start', 'start', 'get']);
    client.dispose();
  });

  test('late response after account switch is discarded', () async {
    var uid = 'alice';
    final client = PrivateCallSignalingClient(
      currentUid: () => uid,
      isAnonymous: () => false,
      idTokenProvider: () async => 'token',
      baseUrl: 'https://example.test/api',
      client: MockClient((request) async {
        uid = 'different_account';
        return http.Response(jsonEncode({
          'ok': true, 'callId': callId, 'status': 'ringing',
        }), 200);
      }),
    );
    await expectLater(
      client.start(
        actorUid: 'alice', otherUid: 'bob',
        conversationId: 'conv1',
        idempotencyKey: 'operation_abcdefgh',
      ),
      throwsA(isA<PrivateCallSignalingException>()
          .having((e) => e.code, 'code', 'account_changed')),
    );
    client.dispose();
  });

  test('disabled production calls return the server error, not fake success',
      () async {
    final client = PrivateCallSignalingClient(
      currentUid: () => 'alice',
      isAnonymous: () => false,
      idTokenProvider: () async => 'token',
      baseUrl: 'https://example.test/api',
      client: MockClient((request) async => http.Response(jsonEncode({
        'ok': false, 'code': 'private_calls_not_ready',
      }), 503)),
    );
    await expectLater(
      client.get(actorUid: 'alice', callId: callId),
      throwsA(isA<PrivateCallSignalingException>()
          .having((e) => e.code, 'code', 'private_calls_not_ready')),
    );
    client.dispose();
  });

  test('call state reports terminal status and never accepts malformed IDs',
      () {
    final state = PrivateCallState.fromJson({
      'callId': callId, 'status': 'completed', 'durationSeconds': 42,
    });
    expect(state.terminal, true);
    expect(state.durationSeconds, 42);
    expect(
      () => PrivateCallState.fromJson({
        'callId': 'untrusted', 'status': 'active',
      }),
      throwsA(isA<PrivateCallSignalingException>()),
    );
  });

  test('an invalid operation is rejected without a network request', () async {
    var requests = 0;
    final client = PrivateCallSignalingClient(
      currentUid: () => 'alice',
      isAnonymous: () => false,
      idTokenProvider: () async => 'token',
      client: MockClient((request) async {
        requests++;
        return http.Response('{}', 200);
      }),
    );
    expect(
      () => client.start(actorUid: 'alice', otherUid: 'bob',
          conversationId: 'conv1', idempotencyKey: 'short'),
      throwsA(isA<PrivateCallSignalingException>()),
    );
    expect(requests, 0);
    client.dispose();
  });
}
