import 'package:flutter/material.dart';

/// One RTL password prompt for room discovery, Home, and search.
/// Password verification remains in the existing room join flow.
Future<String?> showDiscoveryRoomPasswordPrompt(
  BuildContext context,
  String roomName,
) =>
    showDialog<String>(
      context: context,
      builder: (_) => Directionality(
        textDirection: TextDirection.rtl,
        child: _DiscoveryRoomPasswordDialog(roomName: roomName),
      ),
    );

/// The dialog owns the controller until its exit animation unmounts the field.
/// Disposing it immediately when showDialog completes can break the closing UI.
class _DiscoveryRoomPasswordDialog extends StatefulWidget {
  const _DiscoveryRoomPasswordDialog({required this.roomName});

  final String roomName;

  @override
  State<_DiscoveryRoomPasswordDialog> createState() =>
      _DiscoveryRoomPasswordDialogState();
}

class _DiscoveryRoomPasswordDialogState
    extends State<_DiscoveryRoomPasswordDialog> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    if (_controller.text.trim().isEmpty) return;
    Navigator.pop(context, _controller.text);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: const Color(0xFF111321),
      title: Text(
        widget.roomName,
        style: const TextStyle(color: Colors.white),
      ),
      content: TextField(
        controller: _controller,
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
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed: _submit,
          child: const Text('دخول'),
        ),
      ],
    );
  }
}
