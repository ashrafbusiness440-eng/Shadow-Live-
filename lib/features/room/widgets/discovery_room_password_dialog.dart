import 'package:flutter/material.dart';

/// One RTL password prompt for room discovery, Home, and search.
/// Password verification remains in the existing room join flow.
Future<String?> showDiscoveryRoomPasswordPrompt(
  BuildContext context,
  String roomName,
) async {
  final controller = TextEditingController();
  try {
    return await showDialog<String>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF111321),
          title: Text(
            roomName,
            style: const TextStyle(color: Colors.white),
          ),
          content: TextField(
            controller: controller,
            autofocus: true,
            obscureText: true,
            textInputAction: TextInputAction.done,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              labelText: 'كلمة مرور الغرفة',
              labelStyle: TextStyle(color: Colors.white60),
              prefixIcon: Icon(
                Icons.lock_rounded,
                color: Color(0xFFFFD54A),
              ),
            ),
            onSubmitted: (_) {
              if (controller.text.trim().isNotEmpty) {
                Navigator.pop(dialogContext, controller.text);
              }
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                if (controller.text.trim().isEmpty) return;
                Navigator.pop(dialogContext, controller.text);
              },
              child: const Text('دخول'),
            ),
          ],
        ),
      ),
    );
  } finally {
    controller.dispose();
  }
}
