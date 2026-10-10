import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('all expensive Flutter CI checks run concurrently with a final gate',
      () {
    final workflow = File('.github/workflows/flutter-ci.yml')
        .readAsStringSync();

    for (final job in <String>[
      'security-and-integration',
      'flutter-quality',
      'main-tab-browser',
      'voice-room-browser',
      'shadow-control-browser',
    ]) {
      expect(
        workflow.contains('  $job:\\n'.replaceAll('\\n', '\n')),
        isTrue,
        reason: '$job must remain a required parallel job',
      );
    }
    expect(
      workflow.contains(
        'needs: [security-and-integration, flutter-quality, '
        'main-tab-browser, voice-room-browser, shadow-control-browser]',
      ),
      isTrue,
    );
    expect(workflow.contains('    if: \${{ always() }}'), isTrue);
    expect(
      workflow.contains('jq -e \'all(.[]; .result == "success")\''),
      isTrue,
    );
    expect(workflow.contains('    name: analyze-and-test'), isTrue);
  });

  test('no security, financial or browser validation is dropped for speed',
      () {
    final workflow = File('.github/workflows/flutter-ci.yml')
        .readAsStringSync();
    for (final required in <String>[
      'Audit Cloudflare cutover',
      'Pressure regression guardrails',
      'Audit Diaries Stage 09 pressure and security',
      'Audit Agency integration CI coverage',
      'Validate Cloudflare Durable Object bundle',
      'Run economy, agency financial security, mic, and realtime policy unit tests',
      'Run wallet gift agency application and settlement Firestore integration tests',
      'Audit Dart reachability',
      'flutter analyze --no-fatal-infos --no-fatal-warnings lib test',
      'run: flutter test',
      'Build Shadow Control web',
      'Build web',
      'Build E2E web',
      'Run main-tab browser E2E',
      'Run voice-room browser E2E',
      'Run Shadow Control browser E2E',
      'Upload Shadow Control build',
      'Upload web build',
    ]) {
      expect(workflow.contains(required), isTrue, reason: required);
    }
  });
}
