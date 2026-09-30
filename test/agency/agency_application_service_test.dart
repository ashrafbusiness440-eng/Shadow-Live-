import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/agency/services/agency_application_service.dart';

void main() {
  test('parses agency application status and cooldown fields', () {
    final status = AgencyApplicationStatus.fromJson({
      'status': 'rejected',
      'applicationId': 'app_1',
      'canReapply': false,
      'reapplyMode': '24h',
      'remainingSeconds': 3600,
      'rejectionReason': 'missing_data',
    });

    expect(status.isRejected, isTrue);
    expect(status.isPending, isFalse);
    expect(status.canReapply, isFalse);
    expect(status.remainingSeconds, 3600);
    expect(status.reapplyMode, '24h');
    expect(status.rejectionReason, 'missing_data');
  });

  test('loadStatus uses authenticated agency-application endpoint', () async {
    late http.Request captured;
    final service = AgencyApplicationService(
      baseUrl: 'https://example.invalid/api',
      tokenProvider: () async => 'token-123',
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'ok': true,
            'status': 'pending',
            'applicationId': 'app_2',
            'canReapply': false,
            'remainingSeconds': 0,
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    final status = await service.loadStatus();

    expect(captured.url.toString(),
        'https://example.invalid/api/agency-application');
    expect(captured.headers['authorization'], 'Bearer token-123');
    expect(jsonDecode(captured.body), {'action': 'status'});
    expect(status.isPending, isTrue);
    expect(status.applicationId, 'app_2');

    service.close();
  });

  test('submit sends exactly the user draft and a valid idempotency key',
      () async {
    late Map<String, dynamic> payload;
    final service = AgencyApplicationService(
      baseUrl: 'https://example.invalid/api',
      tokenProvider: () async => 'token-123',
      client: MockClient((request) async {
        payload = Map<String, dynamic>.from(
          jsonDecode(request.body) as Map,
        );
        return http.Response(
          jsonEncode({
            'ok': true,
            'applicationId': 'app_3',
            'status': 'pending',
            'name': 'Shadow Agency',
            'country': 'UAE',
            'hostIds': [
              '310001',
              '310002',
              '310003',
              '310004',
              '310005',
            ],
          }),
          200,
        );
      }),
    );

    final result = await service.submit(
      name: ' Shadow Agency ',
      country: ' UAE ',
      hostIds: const [
        '310001',
        '310002',
        '310003',
        '310004',
        '310005',
      ],
    );

    expect(payload['action'], 'submit');
    expect(payload['name'], 'Shadow Agency');
    expect(payload['country'], 'UAE');
    expect(payload['hostIds'], [
      '310001',
      '310002',
      '310003',
      '310004',
      '310005',
    ]);
    expect(
      (payload['idempotencyKey'] as String),
      matches(RegExp(r'^agency_apply_\d{10,}$')),
    );
    expect(result.applicationId, 'app_3');
    expect(result.hostIds.length, 5);

    service.close();
  });

  test('backend application errors remain typed for user-facing mapping',
      () async {
    final service = AgencyApplicationService(
      baseUrl: 'https://example.invalid/api',
      tokenProvider: () async => 'token-123',
      client: MockClient((request) async {
        return http.Response(
          jsonEncode({
            'ok': false,
            'code': 'agency_host_already_in_agency',
          }),
          409,
        );
      }),
    );

    await expectLater(
      service.loadStatus(),
      throwsA(
        isA<AgencyApplicationException>().having(
          (error) => error.code,
          'code',
          'agency_host_already_in_agency',
        ),
      ),
    );

    service.close();
  });
}
