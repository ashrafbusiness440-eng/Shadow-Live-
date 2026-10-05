import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../../services/navigation_service.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../auth/services/auth_login_config.dart';
import '../../auth/setup_route.dart';

class AuthChoiceScreen extends StatefulWidget {
  const AuthChoiceScreen({super.key});

  @override
  State<AuthChoiceScreen> createState() => _AuthChoiceScreenState();
}

class _AuthChoiceScreenState extends State<AuthChoiceScreen> {
  late final Future<AuthLoginConfig> _configFuture;
  late final Future<Uri?> _headerFuture;

  @override
  void initState() {
    super.initState();
    _configFuture = AuthLoginConfigService.load();
    _headerFuture = ShadowAssetRegistry.remoteUrl(
      ShadowAssetKeys.authLoginHeader,
    );
  }

  Widget _authButton({
    required String text,
    required IconData icon,
    required VoidCallback onPressed,
    Color? background,
    Color? foreground,
  }) =>
      SizedBox(
        width: double.infinity,
        height: 54,
        child: ElevatedButton.icon(
          onPressed: onPressed,
          icon: Icon(icon),
          label: Text(
            text,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
          style: ElevatedButton.styleFrom(
            backgroundColor: background ?? const Color(0xFF121728),
            foregroundColor: foreground ?? Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: const BorderSide(color: Color(0x334F8CFF)),
            ),
          ),
        ),
      );

  Widget _headerImage() {
    Widget fallback() => Image.asset(
          'assets/images/auth_header.png',
          fit: BoxFit.cover,
        );

    return SizedBox(
      width: MediaQuery.sizeOf(context).width + 48,
      height: MediaQuery.sizeOf(context).width * .92,
      child: FutureBuilder<Uri?>(
        future: _headerFuture,
        builder: (context, snapshot) {
          final uri = snapshot.data;
          if (uri == null) return fallback();
          return Image.network(
            uri.toString(),
            fit: BoxFit.cover,
            filterQuality: FilterQuality.medium,
            errorBuilder: (_, __, ___) => fallback(),
          );
        },
      ),
    );
  }

  List<Widget> _providerButtons(
    BuildContext context,
    AuthLoginConfig config,
  ) {
    final widgets = <Widget>[];

    void add(Widget button) {
      if (widgets.isNotEmpty) widgets.add(const SizedBox(height: 12));
      widgets.add(button);
    }

    if (config.phone) {
      add(
        _authButton(
          text: 'متابعة برقم الهاتف',
          icon: Icons.phone_android_rounded,
          background: const Color(0xFF8A00FF),
          onPressed: () => Navigator.of(context).pushNamed(AppRoutes.login),
        ),
      );
    }

    if (config.google) {
      add(
        _authButton(
          text: 'متابعة عبر Google',
          icon: Icons.g_mobiledata_rounded,
          background: Colors.white,
          foreground: Colors.black87,
          onPressed: () =>
              context.read<AuthBloc>().add(GoogleSignInRequested()),
        ),
      );
    }

    if (config.apple) {
      add(
        _authButton(
          text: 'متابعة عبر Apple',
          icon: Icons.apple_rounded,
          onPressed: () =>
              context.read<AuthBloc>().add(AppleSignInRequested()),
        ),
      );
    }

    if (config.facebook) {
      add(
        _authButton(
          text: 'متابعة عبر Facebook',
          icon: Icons.facebook_rounded,
          background: const Color(0xFF1877F2),
          onPressed: () =>
              context.read<AuthBloc>().add(FacebookSignInRequested()),
        ),
      );
    }

    if (config.email) {
      add(
        _authButton(
          text: 'متابعة بالبريد الإلكتروني',
          icon: Icons.mail_outline_rounded,
          background: const Color(0xFF2B3150),
          onPressed: () =>
              Navigator.of(context).pushNamed(AppRoutes.emailLogin),
        ),
      );
    }

    if (config.guest) {
      widgets.add(const SizedBox(height: 22));
      widgets.add(
        const Row(
          children: [
            Expanded(child: Divider(color: Colors.white24)),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 14),
              child: Text(
                'أو',
                style: TextStyle(color: Colors.white60),
              ),
            ),
            Expanded(child: Divider(color: Colors.white24)),
          ],
        ),
      );
      widgets.add(const SizedBox(height: 18));
      widgets.add(
        SizedBox(
          width: double.infinity,
          height: 50,
          child: OutlinedButton.icon(
            onPressed: () =>
                context.read<AuthBloc>().add(GuestSignInRequested()),
            icon: const Icon(Icons.person_outline_rounded),
            label: const Text(
              'متابعة كضيف',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.white70,
              side: const BorderSide(color: Colors.white24),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
        ),
      );
    }

    return widgets;
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<AuthBloc, AuthState>(
      listener: (context, state) {
        if (state is EmailVerificationRequired) {
          Navigator.of(context).pushNamedAndRemoveUntil(
            AppRoutes.emailVerification,
            (route) => false,
          );
        } else if (state is Authenticated) {
          final data = state.userData ?? const <String, dynamic>{};
          final isGuest = data['isGuest'] == true || state.user.isAnonymous;
          final destination =
              isGuest ? AppRoutes.main : setupDestination(data);
          Navigator.of(context).pushNamedAndRemoveUntil(
            destination,
            (route) => false,
          );
        } else if (state is AuthError) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.message)),
          );
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: Container(
          width: double.infinity,
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0, -.35),
              radius: 1.1,
              colors: [
                Color(0xFF241044),
                Color(0xFF0B0D18),
                Color(0xFF05060D),
              ],
            ),
          ),
          child: SafeArea(
            child: FutureBuilder<AuthLoginConfig>(
              future: _configFuture,
              initialData: AuthLoginConfig.defaults,
              builder: (context, snapshot) {
                final config = snapshot.data ?? AuthLoginConfig.defaults;
                return SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      _headerImage(),
                      const SizedBox(height: 32),
                      const Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: Text(
                          'تسجيل الدخول / إنشاء حساب',
                          textDirection: TextDirection.rtl,
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 25,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: Text(
                          'اختر الطريقة المناسبة لك',
                          textDirection: TextDirection.rtl,
                          style: TextStyle(
                            color: Colors.white60,
                            fontSize: 15,
                          ),
                        ),
                      ),
                      const SizedBox(height: 26),
                      ..._providerButtons(context, config),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}
