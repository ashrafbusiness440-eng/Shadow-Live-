import 'package:flutter/material.dart';

import '../services/account_action_appeal_service.dart';
import '../services/notification_service.dart';

class AccountActionAppealDialog {
  static String operationIdFrom(AppNotification item) {
    const types = <String>{
      'account_sanction',
      'account_private_messages_restricted',
      'account_room_chat_restricted',
      'account_room_entry_restricted',
      'account_room_mic_restricted',
    };
    if (!types.contains(item.type)) return '';
    final explicit = item.operationId?.trim() ?? '';
    if (RegExp(r'^[A-Za-z0-9_-]{12,180}$').hasMatch(explicit)) {
      return explicit;
    }
    final found = RegExp(
      r'^account_(?:sanction|private_messages|room_chat|room_entry|room_mic)_'
      r'([A-Za-z0-9_-]{12,180})$',
    ).firstMatch(item.id);
    return found?.group(1) ?? '';
  }

  static Future<void> open(BuildContext context, AppNotification item) =>
      openOperation(context,
        operationId: operationIdFrom(item),
        message: item.body,
      );

  // The same authenticated, self-only flow works on a locked account.
  static Future<void> openOperation(BuildContext context, {
    required String operationId,
    required String message,
  }) async {
    if (!RegExp(r'^[A-Za-z0-9_-]{12,180}$').hasMatch(operationId)) return;
    final service = AccountActionAppealService();
    String? status;
    String reason = '';
    try {
      final state = await service.status(operationId);
      status = (state['status'] ?? '').toString();
      reason = (state['decisionReason'] ?? '').toString();
    } catch (error) {
      if (!error.toString().contains('appeal_not_found')) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('تعذّر التحقق من حالة الاعتراض. حاول مجددًا.'),
          ));
        }
        return;
      }
    }
    if (!context.mounted) return;
    final details = TextEditingController();
    try {
      final chosen = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('الاعتراض على الإجراء الإداري'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(message),
                const SizedBox(height: 12),
                if (status != null)
                  Text(status == 'under_review'
                      ? 'اعتراضك قيد المراجعة. لن يُرسل طلب مكرر.'
                      : status == 'accepted'
                          ? 'تم قبول الاعتراض بعد التحقق من رفع العقوبة.'
                          : 'تم رفض الاعتراض بعد المراجعة.'
                            '${reason.isEmpty ? '' : ' السبب: $reason'}'),
                if (status == null)
                  TextField(
                    controller: details,
                    maxLength: 800,
                    minLines: 2,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      labelText: 'توضيحك للإدارة (اختياري)',
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إغلاق'),
            ),
            if (status == null)
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('إرسال الاعتراض'),
              ),
          ],
        ),
      );
      if (chosen != true) return;
      try {
        final result = await service.submit(
          operationId: operationId,
          explanation: details.text.trim(),
        );
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(result['duplicate'] == true
              ? 'اعتراضك مسجّل سابقًا وقيد المراجعة.'
              : 'تم استلام اعتراضك وستصلك نتيجة المراجعة.'),
        ));
      } catch (error) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(error.toString().contains('sanction_not_found')
              ? 'الإجراء غير متاح للاعتراض من هذا الإشعار.'
              : 'تعذّر إرسال الاعتراض. تحقق من الاتصال وحاول مجددًا.'),
        ));
      }
    } finally {
      details.dispose();
    }
  }
}
