import 'package:firebase_auth/firebase_auth.dart';

/// Human-readable recovery guidance for OAuth popup failures.
/// Never alter Firebase authDomain or force a redirect from a GitHub Pages app
/// solely to bypass a browser/session-storage error.
String providerSignInErrorMessage(
  String providerName,
  FirebaseAuthException error,
) {
  final detail = (error.message ?? '').toLowerCase();
  if (detail.contains('missing initial state') ||
      detail.contains('sessionstorage') ||
      detail.contains('storage-partitioned')) {
    return 'انقطعت جلسة تسجيل الدخول في المتصفح. ارجع إلى Shadow Live، '
        'وافتح التطبيق مباشرة في Chrome ثم حاول تسجيل الدخول مجدداً.';
  }

  switch (error.code) {
    case 'popup-blocked':
      return 'المتصفح منع نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة '
          'لهذا الموقع وحاول مرة ثانية.';
    case 'operation-not-supported-in-this-environment':
    case 'web-context-cancelled':
      return 'تعذّر فتح تسجيل الدخول في هذا المتصفح. افتح Shadow Live '
          'مباشرة في Chrome بدلاً من المتصفح داخل تطبيق آخر.';
    case 'unauthorized-domain':
      return 'عنوان التطبيق غير مسموح لتسجيل الدخول. يرجى التواصل مع الإدارة.';
    case 'network-request-failed':
      return 'تعذّر الاتصال بخدمة تسجيل الدخول. تحقق من الإنترنت وحاول مجدداً.';
    case 'account-exists-with-different-credential':
      return 'هذا البريد مرتبط بطريقة دخول ثانية. اختر طريقة الدخول '
          'التي استخدمتها مع الحساب سابقاً.';
    case 'too-many-requests':
      return 'محاولات تسجيل دخول كثيرة. حاول مرة أخرى لاحقاً.';
    default:
      return 'تعذّر تسجيل الدخول بواسطة $providerName. '
          'ارجع إلى التطبيق وحاول مرة ثانية.';
  }
}
