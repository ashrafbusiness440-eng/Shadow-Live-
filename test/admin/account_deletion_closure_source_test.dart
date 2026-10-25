import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Owner closure UI only reads six existing signoff domains and never erases', () {
    final page = File('lib/admin/account_deletion_owner_review_page.dart')
        .readAsStringSync();
    final route = File('cloudflare-worker/src/admin-inbox.js')
        .readAsStringSync();
    final helper = File(
      'cloudflare-worker/src/account-deletion-closure-readiness.js',
    ).readAsStringSync();

    expect(page.contains("'accountDeletionClosureReadiness'"), isTrue);
    expect(page.contains('فحص حالة الاعتمادات الستة (دون حذف)'), isTrue);
    expect(page.contains('استقلال') ||
        page.contains('التحقق الفعلي مستقل'), isTrue);
    expect(page.contains('result[\'erasureAllowed\'] != false'), isTrue);
    expect(page.contains('result[\'destructiveAllowed\'] != false'), isTrue);
    expect(page.contains('result[\'processingAdmitted\'] != false'), isTrue);
    expect(page.contains('result[\'completionVerified\'] != false'), isTrue);
    expect(page.contains('result[\'independentEvidenceVerified\'] != false'), isTrue);
    expect(page.contains('_closure = null;'), isTrue);

    // Same Owner-only admin route, not a new public endpoint or unsafe path.
    expect(route.contains('if (action === "accountDeletionClosureReadiness")'),
        isTrue);
    expect(route.contains('recent_auth_required'), isTrue);
    expect(helper.contains('REQUIRED_ERASURE_ADMISSION_DOMAINS'), isTrue);
    expect(helper.contains('validateErasureDomainSignoff'), isTrue);
    expect(helper.contains('destructiveAllowed: false'), isTrue);
    expect(helper.contains('erasureAllowed: false'), isTrue);
    expect(helper.contains('db.commit('), isFalse);
    expect(helper.contains('db.runQuery('), isFalse);
  });
}
