import 'package:flutter/material.dart';

import 'control_firebase.dart';
import 'reports_hub_page.dart';

/// Inbox navigation reuses the same reports hub; no parallel report UI.
ReportsHubSection reportSectionForInboxType(String type) => switch (type) {
  'diary_report' => ReportsHubSection.diaries,
  'account_report' => ReportsHubSection.people,
  'system_repeat_flag' => ReportsHubSection.system,
  'user_report' || 'room_message_report' || 'room_report' =>
    ReportsHubSection.roomsAndMessages,
  _ => ReportsHubSection.roomsAndMessages,
};

class ReportsHubInboxRoute extends StatefulWidget {
  const ReportsHubInboxRoute({
    super.key,
    required this.reportId,
    required this.reportType,
  });

  final String reportId;
  final String reportType;

  @override
  State<ReportsHubInboxRoute> createState() => _ReportsHubInboxRouteState();
}

class _ReportsHubInboxRouteState extends State<ReportsHubInboxRoute> {
  late final Future<Map<String, dynamic>?> _access = _loadAccess();

  Future<Map<String, dynamic>?> _loadAccess() async {
    final uid = controlAuth.currentUser?.uid;
    if (uid == null) return null;
    final snapshot = await controlFirestore.collection('users').doc(uid).get();
    return snapshot.data();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, dynamic>?>(
      future: _access,
      builder: (context, snapshot) {
        if (!snapshot.hasData && !snapshot.hasError &&
            snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        final actor = snapshot.data;
        if (actor == null) {
          return const Scaffold(
            body: Center(child: Text('تعذّر التحقق من صلاحيات عرض البلاغ.')),
          );
        }
        final enabled = actor['adminEnabled'] == true;
        final owner = enabled && actor['role'] == 'owner';
        final capabilities = actor['capabilities'] is List
            ? (actor['capabilities'] as List).map((e) => e.toString()).toSet()
            : <String>{};
        final general = owner || (enabled &&
            (capabilities.contains('viewReports') ||
             capabilities.contains('reviewReports')));
        final diaries = general || (enabled &&
            (capabilities.contains('manageDiaries') ||
             capabilities.contains('deleteDiaryComment')));
        return ReportsHubPage(
          allowGeneral: general,
          allowDiary: diaries,
          initialSection: reportSectionForInboxType(widget.reportType),
          initialReportId: widget.reportId,
        );
      },
    );
  }
}
