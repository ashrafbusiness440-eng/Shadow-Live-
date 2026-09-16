import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../services/navigation_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  static const _gold = Color(0xFFFFD166);
  static const _purple = Color(0xFF8B5CF6);
  static const _deep = Color(0xFF050814);

  Future<void> _confirmLogout(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF101827),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: Color(0x558B5CF6)),
          ),
          title: const Row(children: [
            Icon(Icons.logout_rounded, color: Colors.redAccent),
            SizedBox(width: 10),
            Text('تسجيل الخروج', style: TextStyle(color: Colors.white)),
          ]),
          content: const Text(
            'هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟',
            style: TextStyle(color: Colors.white70, height: 1.5),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('إلغاء', style: TextStyle(color: Colors.white70)),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('تسجيل الخروج'),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true && context.mounted) {
      context.read<AuthBloc>().add(SignOutRequested());
      NavigationService.navigateToAndRemoveUntil(AppRoutes.authChoice);
    }
  }

  void _comingSoon(BuildContext context, String feature) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$feature — سيتم تفعيلها لاحقاً')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: _deep,
        body: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0.6, -0.7),
              radius: 1.25,
              colors: [Color(0xFF24103F), Color(0xFF07111E), _deep],
            ),
          ),
          child: SafeArea(
            child: Column(
              children: [
                _buildHeader(context),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
                    child: Column(
                      children: [
                        _buildProfileCard(),
                        const SizedBox(height: 18),
                        _buildMenuCard(items: [
                          _SettingItem(
                            icon: Icons.person_rounded,
                            title: 'تعديل الملف الشخصي',
                            onTap: () => NavigationService.navigateTo(AppRoutes.profileSetup),
                          ),
                          _SettingItem(
                            icon: Icons.shield_rounded,
                            title: 'الحساب والأمان',
                            onTap: () => _comingSoon(context, 'الحساب والأمان'),
                          ),
                          _SettingItem(
                            icon: Icons.account_balance_wallet_rounded,
                            title: 'محفظتي',
                            onTap: () => _comingSoon(context, 'المحفظة'),
                          ),
                          _SettingItem(
                            icon: Icons.palette_rounded,
                            title: 'مظهر التطبيق',
                            onTap: () => _comingSoon(context, 'مظهر التطبيق'),
                          ),
                          _SettingItem(
                            icon: Icons.notifications_rounded,
                            title: 'الإشعارات',
                            onTap: () => _comingSoon(context, 'الإشعارات'),
                          ),
                          _SettingItem(
                            icon: Icons.lock_rounded,
                            title: 'الخصوصية',
                            onTap: () => _comingSoon(context, 'الخصوصية'),
                          ),
                          _SettingItem(
                            icon: Icons.language_rounded,
                            title: 'اللغة',
                            subtitle: 'العربية',
                            onTap: () => _comingSoon(context, 'اللغات'),
                          ),
                          _SettingItem(
                            icon: Icons.help_rounded,
                            title: 'المساعدة',
                            onTap: () => _comingSoon(context, 'المساعدة'),
                          ),
                          _SettingItem(
                            icon: Icons.info_rounded,
                            title: 'حول التطبيق',
                            subtitle: 'Shadow Live',
                            onTap: () => _comingSoon(context, 'حول التطبيق'),
                          ),
                        ]),
                        const SizedBox(height: 18),
                        _buildVipCard(),
                        const SizedBox(height: 18),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            onPressed: () => _confirmLogout(context),
                            icon: const Icon(Icons.logout_rounded),
                            label: const Text('تسجيل الخروج'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.redAccent,
                              side: const BorderSide(color: Color(0x66FF5252)),
                              padding: const EdgeInsets.symmetric(vertical: 15),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      child: Row(children: [
        IconButton(
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white),
        ),
        const Expanded(
          child: Column(children: [
            Icon(Icons.mic_rounded, color: _gold, size: 30),
            SizedBox(height: 2),
            Text('SHADOW LIVE',
                style: TextStyle(color: _gold, fontWeight: FontWeight.w900, letterSpacing: 1.2, fontSize: 14)),
          ]),
        ),
        const SizedBox(width: 48),
      ]),
    );
  }

  Widget _buildProfileCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xCC0B1322),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0x444D67FF)),
        boxShadow: const [BoxShadow(color: Color(0x338B5CF6), blurRadius: 24)],
      ),
      child: const Row(children: [
        CircleAvatar(radius: 36, backgroundColor: Color(0xFF25124D), child: Icon(Icons.person_rounded, color: _gold, size: 42)),
        SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('حسابي', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 20)),
            SizedBox(height: 6),
            Text('إدارة معلومات الحساب والإعدادات', style: TextStyle(color: Colors.white54, fontSize: 13)),
          ]),
        ),
        Icon(Icons.workspace_premium_rounded, color: _gold, size: 30),
      ]),
    );
  }

  Widget _buildMenuCard({required List<_SettingItem> items}) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xCC0B1322),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0x334D67FF)),
      ),
      child: Column(
        children: List.generate(items.length, (index) {
          final item = items[index];
          return Column(children: [
            ListTile(
              minVerticalPadding: 12,
              leading: Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  gradient: const LinearGradient(colors: [Color(0xFF25124D), Color(0xFF111827)]),
                ),
                child: Icon(item.icon, color: _purple, size: 24),
              ),
              title: Text(item.title,
                  style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
              subtitle: item.subtitle == null
                  ? null
                  : Text(item.subtitle!, style: const TextStyle(color: Colors.white54, fontSize: 12)),
              trailing: const Icon(Icons.chevron_left_rounded, color: Colors.white38),
              onTap: item.onTap,
            ),
            if (index != items.length - 1)
              const Divider(height: 1, indent: 70, color: Color(0x221fffffff)),
          ]);
        }),
      ),
    );
  }

  Widget _buildVipCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [Color(0xFF2A153F), Color(0xFF120C20), Color(0xFF1D1207)],
        ),
        border: Border.all(color: const Color(0x88FFD166)),
        boxShadow: const [BoxShadow(color: Color(0x33FFD166), blurRadius: 24)],
      ),
      child: const Column(children: [
        Icon(Icons.workspace_premium_rounded, size: 56, color: _gold),
        SizedBox(height: 8),
        Text('كن مميزاً', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900)),
        SizedBox(height: 4),
        Text('Shadow Live VIP', style: TextStyle(color: Colors.white70, fontSize: 16)),
        SizedBox(height: 12),
        Text('مزايا VIP ستتوفر في مرحلة نظام العضويات',
            textAlign: TextAlign.center, style: TextStyle(color: Colors.white54)),
      ]),
    );
  }
}

class _SettingItem {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;

  const _SettingItem({required this.icon, required this.title, this.subtitle, this.onTap});
}
