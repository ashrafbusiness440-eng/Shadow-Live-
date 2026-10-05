import 'package:flutter/material.dart';

import '../services/diary_service.dart';

String? activeDiaryMentionQuery(TextEditingController controller) {
  final selection = controller.selection;
  final cursor = selection.isValid
      ? selection.extentOffset.clamp(0, controller.text.length)
      : controller.text.length;
  final before = controller.text.substring(0, cursor);
  final match = RegExp(r'@([^\s@]{1,40})$').firstMatch(before);
  final query = match?.group(1)?.trim() ?? '';
  return query.isEmpty ? null : query;
}

void applyDiaryMention(
  TextEditingController controller,
  DiaryMentionCandidate candidate,
) {
  final selection = controller.selection;
  final cursor = selection.isValid
      ? selection.extentOffset.clamp(0, controller.text.length)
      : controller.text.length;
  final before = controller.text.substring(0, cursor);
  final match = RegExp(r'@([^\s@]{1,40})$').firstMatch(before);
  if (match == null) return;

  final replacement = '@${candidate.publicId} ';
  final next = controller.text.replaceRange(
    match.start,
    cursor,
    replacement,
  );
  final nextCursor = match.start + replacement.length;
  controller.value = TextEditingValue(
    text: next,
    selection: TextSelection.collapsed(offset: nextCursor),
  );
}

class DiaryMentionSuggestions extends StatelessWidget {
  const DiaryMentionSuggestions({
    super.key,
    required this.items,
    required this.loading,
    required this.onSelected,
  });

  final List<DiaryMentionCandidate> items;
  final bool loading;
  final ValueChanged<DiaryMentionCandidate> onSelected;

  @override
  Widget build(BuildContext context) {
    if (!loading && items.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(top: 6),
      constraints: const BoxConstraints(maxHeight: 210),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white12),
      ),
      child: loading && items.isEmpty
          ? const Padding(
              padding: EdgeInsets.all(12),
              child: Center(
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          : ListView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.symmetric(vertical: 4),
              itemCount: items.length,
              itemBuilder: (context, index) {
                final item = items[index];
                final avatar = item.profileImageUrl.isNotEmpty
                    ? NetworkImage(item.profileImageUrl)
                    : null;
                return ListTile(
                  dense: true,
                  onTap: () => onSelected(item),
                  leading: CircleAvatar(
                    radius: 18,
                    backgroundImage: avatar,
                    child: avatar == null
                        ? const Icon(Icons.person_rounded, size: 18)
                        : null,
                  ),
                  title: Text(
                    item.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  subtitle: Text(
                    '@${item.publicId}',
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(color: Colors.white54),
                  ),
                );
              },
            ),
    );
  }
}
