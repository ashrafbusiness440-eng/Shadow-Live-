import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('index sync does not reprovision unrelated old definitions', () {
    final workflow =
        File('.github/workflows/deploy-firestore-rules.yml').readAsStringSync();
    expect(workflow.contains('signatures(current) - signatures(previous)'), isTrue);
    expect(workflow.contains('run_index_sync=$new_indexes'), isTrue);
    expect(workflow.contains('Only removed/unchanged index definitions'), isTrue);
    expect(workflow.contains('run_index_sync=true'), isTrue,
        reason: 'Manual dispatch and first-time setup still provision indexes');
    expect(workflow.contains('if: steps.indexes_scope.outputs.run_index_sync =='), isTrue);
  });
}
