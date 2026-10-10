import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../features/profile/widgets/profile_avatar_with_frame.dart';

/// Reusable public-only identity for authorized moderation and admin notices.
/// Never infer an account name from a report id or expose private contact data.
class AdminAccountIdentity {
  const AdminAccountIdentity({
    required this.uid,
    required this.displayName,
    required this.publicId,
    required this.profile,
  });

  final String uid;
  final String displayName;
  final String publicId;
  final Map<String, dynamic> profile;

  factory AdminAccountIdentity.fromProfile(
    String uid,
    Map<String, dynamic>? raw,
  ) {
    final profile = raw ?? const <String, dynamic>{};
    final name = (profile['displayName'] ?? '').toString().trim();
    return AdminAccountIdentity(
      uid: uid.trim(),
      displayName: name.isEmpty || name == 'Shadow Live'
          ? 'الاسم غير متاح'
          : name,
      publicId: (profile['publicId'] ?? '').toString().trim(),
      profile: profile,
    );
  }

  String get displayId => publicId.isNotEmpty ? publicId : 'غير متاح';

  String get shortUid {
    if (uid.length <= 16) return uid;
    return uid.substring(0, 7) + '…' + uid.substring(uid.length - 6);
  }
}

/// Summary is always shown beside the administrative action; tapping opens
/// more public account details and copyable identifiers, without new reads.
class AdminAccountIdentityTile extends StatelessWidget {
  const AdminAccountIdentityTile({
    super.key,
    required this.roleLabel,
    required this.identity,
  });

  final String roleLabel;
  final AdminAccountIdentity identity;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: identity.uid.isNotEmpty,
      label: roleLabel + ': ' + identity.displayName,
      child: InkWell(
        onTap: identity.uid.isEmpty
            ? null
            : () => showAdminAccountIdentity(context, roleLabel, identity),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFF221B32),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white10),
          ),
          child: Row(
            children: [
              ProfileAvatarWithFrame(
                userId: identity.uid,
                fallbackProfile: identity.profile,
                snapshotOnly: true,
                diameter: 36,
                backgroundColor: const Color(0xFF171D31),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      roleLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white54, fontSize: 11),
                    ),
                    Text(
                      identity.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      'ID: ' + identity.displayId,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Color(0xFFD9C1FF), fontSize: 10),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.chevron_left_rounded, color: Colors.white54),
            ],
          ),
        ),
      ),
    );
  }
}

Future<void> showAdminAccountIdentity(
  BuildContext context,
  String roleLabel,
  AdminAccountIdentity identity,
) async {
  if (identity.uid.isEmpty) return;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF14101F),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (sheetContext) => Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(roleLabel, style: const TextStyle(
                color: Color(0xFFFFD54A),
                fontSize: 15,
                fontWeight: FontWeight.w800,
              )),
              const SizedBox(height: 12),
              Row(
                children: [
                  ProfileAvatarWithFrame(
                    userId: identity.uid,
                    fallbackProfile: identity.profile,
                    snapshotOnly: true,
                    diameter: 54,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      identity.displayName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text('ID الظاهر: ' + identity.displayId),
              const SizedBox(height: 6),
              Text(
                'معرّف الحساب: ' + identity.shortUid,
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: identity.uid));
                      if (sheetContext.mounted) {
                        ScaffoldMessenger.of(sheetContext).showSnackBar(
                          const SnackBar(content: Text('تم نسخ معرّف الحساب')),
                        );
                      }
                    },
                    icon: const Icon(Icons.copy_rounded),
                    label: const Text('نسخ معرّف الحساب'),
                  ),
                  if (identity.publicId.isNotEmpty)
                    OutlinedButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(
                          ClipboardData(text: identity.publicId),
                        );
                        if (sheetContext.mounted) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            const SnackBar(content: Text('تم نسخ ID')),
                          );
                        }
                      },
                      icon: const Icon(Icons.copy_rounded),
                      label: const Text('نسخ ID'),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
