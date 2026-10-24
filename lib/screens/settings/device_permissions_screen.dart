import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../firebase_options.dart';
import '../../shared/services/shadow_device_permissions.dart';

/// A user-initiated review of Android OS permissions. No account listeners,
/// polling, Firebase writes, or permission requests on page entry.
class DevicePermissionsScreen extends StatefulWidget {
  const DevicePermissionsScreen({super.key});

  @override
  State<DevicePermissionsScreen> createState() =>
      _DevicePermissionsScreenState();
}

class _DevicePermissionsScreenState extends State<DevicePermissionsScreen> {
  PermissionStatus? _microphone;
  PermissionStatus? _notifications;
  bool _busy = false;
  bool _loading = true;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    if (!ShadowDevicePermissions.isAndroid) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    if (mounted) setState(() => _loading = true);
    try {
      final statuses = await Future.wait<PermissionStatus?>([
        ShadowDevicePermissions.microphoneStatus(),
        ShadowDevicePermissions.notificationStatus(),
      ]);
      if (!mounted) return;
      setState(() {
        _microphone = statuses[0];
        _notifications = statuses[1];
      });
    } catch (_) {
      if (mounted) {
        setState(() => _notice = 'تعذر قراءة الأذونات. افتح إعدادات الجهاز للتحقق.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _requestMicrophone() async {
    if (_busy || _loading) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      final result = await ShadowDevicePermissions.ensureMicrophone();
      if (!mounted) return;
      setState(() {
        _notice = switch (result) {
          ShadowMicrophoneAccess.granted => 'تم السماح باستخدام الميكروفون.',
          ShadowMicrophoneAccess.settingsRequired =>
            'الإذن محظور من Android. افتح إعدادات التطبيق لتغييره.',
          ShadowMicrophoneAccess.denied =>
            'تم رفض إذن الميكروفون. يمكنك المحاولة مجددًا.',
        };
      });
    } catch (_) {
      if (mounted) setState(() => _notice = 'تعذر طلب إذن الميكروفون.');
    } finally {
      if (mounted) setState(() => _busy = false);
      await _refresh();
    }
  }

  Future<void> _requestNotifications() async {
    if (_busy || _loading) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      final status =
          await ShadowDevicePermissions.requestNotificationPermission();
      if (!mounted) return;
      setState(() {
        _notice = status?.isGranted == true
            ? 'تم السماح بإشعارات Android. وصول الإشعارات يحتاج أيضًا تهيئة خدمة Firebase.'
            : 'لم يتم السماح بالإشعارات. يمكنك فتح إعدادات التطبيق.';
      });
    } catch (_) {
      if (mounted) setState(() => _notice = 'تعذر طلب إذن الإشعارات.');
    } finally {
      if (mounted) setState(() => _busy = false);
      await _refresh();
    }
  }

  Future<void> _openDeviceSettings() async {
    await ShadowDevicePermissions.openSystemSettings();
    if (mounted) {
      setState(() => _notice = 'بعد العودة من إعدادات الهاتف اضغط تحديث الحالة.');
    }
  }

  Widget _permissionCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required PermissionStatus? status,
    required VoidCallback request,
  }) {
    final granted = status?.isGranted == true;
    final blocked =
        status?.isPermanentlyDenied == true || status?.isRestricted == true;
    return Card(
      color: const Color(0xFF19132D),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(icon, color: const Color(0xFFFFD166)),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(title,
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.bold)),
                ),
                Text(
                  granted ? 'مسموح' : blocked ? 'محظور' : 'غير مسموح',
                  style: TextStyle(
                    color: granted ? Colors.greenAccent : Colors.white70,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(subtitle, style: const TextStyle(color: Colors.white70)),
            const SizedBox(height: 10),
            if (!granted)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _busy || _loading
                      ? null
                      : blocked ? _openDeviceSettings : request,
                  icon: Icon(blocked ? Icons.settings : Icons.check_circle_outline),
                  label: Text(blocked ? 'فتح إعدادات الهاتف' : 'طلب السماح'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF090917),
          appBar: AppBar(
            title: const Text('أذونات التطبيق'),
            backgroundColor: const Color(0xFF170F2C),
            actions: [
              IconButton(
                tooltip: 'تحديث الحالة',
                onPressed: _busy || _loading ? null : _refresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          body: !ShadowDevicePermissions.isAndroid
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'هذه الصفحة مخصصة لأذونات نسخة Android. '
                      'المتصفح يطلب أذوناته عند استخدام الميزة.',
                      style: TextStyle(color: Colors.white70),
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(14),
                  children: [
                    const Text(
                      'تقدر تراجع الأذونات وتسمح بها وقت الحاجة. '
                      'ما منطلب إذن الميكروفون أو الإشعارات بمجرد فتح التطبيق.',
                      style: TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 14),
                    _permissionCard(
                      icon: Icons.mic_rounded,
                      title: 'الميكروفون',
                      subtitle: 'ضروري للتحدث على مايك الغرفة '
                          'أو تسجيل رسالة صوتية.',
                      status: _microphone,
                      request: _requestMicrophone,
                    ),
                    _permissionCard(
                      icon: Icons.notifications_active_rounded,
                      title: 'الإشعارات',
                      subtitle: 'إذن Android للسماح بالإشعارات. '
                          'منح الإذن لا يعني تشغيل تنبيهات المكالمات تلقائيًا.',
                      status: _notifications,
                      request: _requestNotifications,
                    ),
                    if (!DefaultFirebaseOptions.androidMessagingConfigured)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: Text(
                          'تنبيهات المكالمات عبر Firebase غير جاهزة '
                          'في إعداد بناء Android الحالي. '
                          'يلزم ربط تطبيق Firebase Android الأصلي '
                          'قبل تفعيل الإرسال الفعلي.',
                          style: TextStyle(color: Color(0xFFFFD166)),
                        ),
                      ),
                    if (_notice != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        child: Text(_notice!,
                            style: const TextStyle(color: Colors.white)),
                      ),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _openDeviceSettings,
                      icon: const Icon(Icons.settings_outlined),
                      label: const Text('إعدادات الأذونات في الهاتف'),
                    ),
                  ],
                ),
        ),
      );
}
