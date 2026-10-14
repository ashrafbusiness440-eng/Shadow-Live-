import 'package:flutter/material.dart';

import 'diary_reports_control_page.dart';
import 'general_reports_control_page.dart';
import 'general_reports_history_page.dart';
import 'system_reports_control_page.dart';

/// Each tab mounts one existing bounded moderation screen at a time.
/// This keeps inactive report requests and subscriptions out of memory.
enum ReportsHubSection { roomsAndMessages, people, diaries, system }

class ReportsHubPage extends StatefulWidget {
  const ReportsHubPage({
    super.key,
    required this.allowGeneral,
    required this.allowDiary,
    this.initialSection,
    this.initialReportId,
  });

  final bool allowGeneral;
  final bool allowDiary;
  final ReportsHubSection? initialSection;
  final String? initialReportId;

  @override
  State<ReportsHubPage> createState() => _ReportsHubPageState();
}

class _ReportsHubPageState extends State<ReportsHubPage> {
  late ReportsHubSection _section;
  int _reloadCount = 0;
  bool _historyOpen = false;
  String? _focusedReportId;

  @override
  void initState() {
    super.initState();
    _focusedReportId = widget.initialReportId;
    _section = widget.initialSection ?? (widget.allowGeneral
        ? ReportsHubSection.roomsAndMessages
        : ReportsHubSection.diaries);
  }

  bool _allowed(ReportsHubSection section) =>
      section == ReportsHubSection.diaries
          ? widget.allowDiary
          : widget.allowGeneral;

  Widget _tab(ReportsHubSection section, String label, IconData icon) {
    final active = _section == section;
    final allowed = _allowed(section);
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3),
        child: Material(
          color: active
              ? const Color(0xFF322047)
              : const Color(0xFF1A1329),
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            key: Key('reports-tab-${section.name}'),
            borderRadius: BorderRadius.circular(14),
            onTap: allowed ? () => setState(() {
              _section = section;
              _historyOpen = false;
              _focusedReportId = null;
              _reloadCount++;
            }) : null,
            child: Container(
              constraints: const BoxConstraints(minHeight: 76),
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 8),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: active
                      ? const Color(0xFFD2B3FA)
                      : const Color(0xFF40354F),
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 19, color: !allowed
                      ? Colors.white30 : active
                          ? const Color(0xFFE3BD63)
                          : const Color(0xFFC6B4DB)),
                  const SizedBox(height: 5),
                  Text(
                    label,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      height: 1.2,
                      fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                      fontSize: 11,
                      color: allowed ? Colors.white : Colors.white38,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _currentSection() {
    if (!_allowed(_section)) {
      return const Center(child: Text('ليس لديك صلاحية لعرض هذا البلاغ.'));
    }
    if (_historyOpen && _section != ReportsHubSection.diaries &&
        _section != ReportsHubSection.system) {
      return GeneralReportsHistoryPage(
        key: ValueKey('reports-history-${_section.name}-$_reloadCount'),
        embedded: true,
        scope: _section == ReportsHubSection.people ? 'people' : 'rooms_messages',
      );
    }
    final focused = widget.initialSection == _section
        ? _focusedReportId : null;
    switch (_section) {
      case ReportsHubSection.roomsAndMessages:
        return GeneralReportsControlPage(
          key: ValueKey('reports-hub-rooms-$_reloadCount'),
          scope: 'rooms_messages',
          initialReportId: focused,
          embedded: true,
        );
      case ReportsHubSection.people:
        return GeneralReportsControlPage(
          key: ValueKey('reports-hub-people-$_reloadCount'),
          scope: 'people',
          initialReportId: focused,
          embedded: true,
        );
      case ReportsHubSection.system:
        return SystemReportsControlPage(
          initialActorUid: focused,
          key: ValueKey('reports-hub-system-$_reloadCount'),
        );
      case ReportsHubSection.diaries:
        return DiaryReportsControlPage(
          key: ValueKey('reports-hub-diaries-$_reloadCount'),
          initialReportId: focused,
          embedded: true,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final allowedAny = widget.allowGeneral || widget.allowDiary;
    return Scaffold(
      appBar: AppBar(
        title: const Text('البلاغات'),
        actions: [
          IconButton(
            tooltip: 'تحديث البلاغات',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => setState(() => _reloadCount++),
          ),
          if (widget.allowGeneral &&
              _section != ReportsHubSection.diaries &&
              _section != ReportsHubSection.system)
            IconButton(
              tooltip: _historyOpen ? 'البلاغات الحالية' : 'البلاغات السابقة والمغلقة',
              icon: Icon(_historyOpen
                  ? Icons.assignment_outlined : Icons.history_rounded),
              onPressed: () => setState(() {
                _historyOpen = !_historyOpen;
                _focusedReportId = null;
                _reloadCount++;
              }),
            ),
        ],
      ),
      body: !allowedAny
          ? const Center(child: Text('ليس لديك صلاحية لعرض البلاغات.'))
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: Text(
                      _historyOpen ? 'سجل البلاغات السابقة' : 'مركز البلاغات',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFFE6D5FF),
                      ),
                    ),
                  ),
                ),
                if (_focusedReportId != null)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      key: const Key('reports-back-to-list'),
                      icon: const Icon(Icons.arrow_back_rounded),
                      label: const Text('العودة إلى قائمة البلاغات'),
                      onPressed: () => setState(() {
                        _focusedReportId = null;
                        _reloadCount++;
                      }),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                  child: Row(
                    children: [
                      _tab(ReportsHubSection.roomsAndMessages,
                          'الغرف والرسائل', Icons.forum_outlined),
                      _tab(ReportsHubSection.people,
                          'الأشخاص', Icons.person_outline_rounded),
                      _tab(ReportsHubSection.diaries,
                          'يومياتي والتعليقات', Icons.auto_stories_outlined),
                      _tab(ReportsHubSection.system,
                          'بلاغات النظام', Icons.gpp_maybe_outlined),
                    ],
                  ),
                ),
                Expanded(
                  // No IndexedStack: the deselected tab does not issue reads.
                  child: _currentSection(),
                ),
              ],
            ),
    );
  }
}
