import 'package:flutter/material.dart';

class DiaryReportReason {
  const DiaryReportReason(this.code, this.label);

  final String code;
  final String label;
}

const diaryReportReasons = <DiaryReportReason>[
  DiaryReportReason('abusive_content', 'محتوى مسيء'),
  DiaryReportReason('harassment_bullying', 'تحرش/تنمر'),
  DiaryReportReason('spam', 'سبام'),
  DiaryReportReason('inappropriate_image', 'صورة غير مناسبة'),
  DiaryReportReason('impersonation', 'انتحال'),
  DiaryReportReason('other_violation', 'مخالفة أخرى'),
];

Future<String?> showDiaryReportReasonSheet(BuildContext context) {
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: const Color(0xFF0D1220),
    showDragHandle: true,
    builder: (sheetContext) => Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'سبب الإبلاغ',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'اختر السبب الأنسب. سيصل البلاغ إلى فريق المراجعة.',
                style: TextStyle(color: Colors.white54),
              ),
              const SizedBox(height: 10),
              ...diaryReportReasons.map(
                (reason) => ListTile(
                  dense: true,
                  leading: const Icon(
                    Icons.flag_outlined,
                    color: Color(0xFFFFD54A),
                  ),
                  title: Text(
                    reason.label,
                    style: const TextStyle(color: Colors.white),
                  ),
                  onTap: () => Navigator.pop(sheetContext, reason.code),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
