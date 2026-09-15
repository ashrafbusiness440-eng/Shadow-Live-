import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../../services/navigation_service.dart';

class AuthChoiceScreen extends StatelessWidget {
  const AuthChoiceScreen({super.key});

  Widget _authButton({
    required BuildContext context,
    required String text,
    required IconData icon,
    required VoidCallback onPressed,
    Color? background,
    Color? foreground,
  }) {
    return SizedBox(
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
            side: const BorderSide(
              color: Color(0x334F8CFF),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<AuthBloc, AuthState>(
      listener: (context, state) {
        if (state is Authenticated) {
          final step = state.userData?['setupStep']?.toString();

          final String destination;

          switch (step) {
            case 'success':
              destination = AppRoutes.accountSuccess;
              break;
            case 'linking':
              destination = AppRoutes.accountLinking;
              break;
            case 'ready':
              destination = AppRoutes.accountReady;
              break;
            case 'complete':
              destination = AppRoutes.main;
              break;
            case 'profile':
            default:
              destination = AppRoutes.profileSetup;
          }

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
              center: Alignment(0, -0.35),
              radius: 1.1,
              colors: [
                Color(0xFF241044),
                Color(0xFF0B0D18),
                Color(0xFF05060D),
              ],
            ),
          ),
          child: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  const SizedBox(height: 0),
                  Transform.translate(
                    offset: const Offset(0, 0),
                    child: SizedBox(
                      width: MediaQuery.sizeOf(context).width + 48,
                      height: MediaQuery.sizeOf(context).width * 0.92,
                      child: Image.asset(
                        'assets/images/auth_header.png',
                        width: double.infinity,
                        height: double.infinity,
                        fit: BoxFit.cover,
                        alignment: Alignment.center,
                      ),
                    ),
                  ),
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
                  _authButton(
                    context: context,
                    text: 'متابعة برقم الهاتف',
                    icon: Icons.phone_android_rounded,
                    background: const Color(0xFF8A00FF),
                    onPressed: () {
                      Navigator.of(context).pushNamed(AppRoutes.login);
                    },
                  ),
                  const SizedBox(height: 12),
                  _authButton(
                    context: context,
                    text: 'متابعة عبر Google',
                    icon: Icons.g_mobiledata_rounded,
                    background: Colors.white,
                    foreground: Colors.black87,
                    onPressed: () {
                      context.read<AuthBloc>().add(GoogleSignInRequested());
                    },
                  ),
                  const SizedBox(height: 12),
                  _authButton(
                    context: context,
                    text: 'متابعة عبر Apple',
                    icon: Icons.apple_rounded,
                    onPressed: () {
                      context.read<AuthBloc>().add(AppleSignInRequested());
                    },
                  ),
                  const SizedBox(height: 12),
                  _authButton(
                    context: context,
                    text: 'متابعة عبر Facebook',
                    icon: Icons.facebook_rounded,
                    background: const Color(0xFF1877F2),
                    onPressed: () {},
                  ),
                  const SizedBox(height: 22),
                  Row(
                    children: const [
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
                  const SizedBox(height: 22),
                  TextButton(
                    onPressed: () {
                      Navigator.of(context).pushNamed(AppRoutes.login);
                    },
                    child: const Text(
                      'لديك حساب بالفعل؟ تسجيل الدخول',
                      textDirection: TextDirection.rtl,
                      style: TextStyle(
                        color: Color(0xFFFFD54A),
                        fontSize: 15,
                      ),
                    ),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    textDirection: TextDirection.rtl,
                    children: [
                      TextButton(
                        onPressed: () {
                          context.read<AuthBloc>().add(GuestSignInRequested());
                        },
                        child: const Text(
                          'متابعة كضيف',
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 15,
                          ),
                        ),
                      ),
                      const Text(
                        ' | ',
                        style: TextStyle(
                          color: Colors.white38,
                          fontSize: 16,
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          Navigator.of(context).pushNamed(AppRoutes.emailLogin);
                        },
                        child: const Text(
                          'التسجيل بالبريد الإلكتروني',
                          style: TextStyle(
                            color: Color(0xFFFFD54A),
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
