import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/auth_bloc.dart';
import '../../../shared/widgets/custom_button.dart';
import '../../../shared/widgets/custom_text_field.dart';
import '../../../shared/widgets/loading_indicator.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();

  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _phoneController = TextEditingController();
  final _otpController = TextEditingController();

  bool _isPasswordVisible = false;
  bool _usePhone = true;
  String? _verificationId;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _phoneController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  void _loginEmail() {
    if (_formKey.currentState?.validate() ?? false) {
      context.read<AuthBloc>().add(
            SignInRequested(
              _emailController.text.trim(),
              _passwordController.text,
            ),
          );
    }
  }

  void _sendOtp() {
    final phone = _phoneController.text.trim();

    if (phone.isEmpty || !phone.startsWith('+')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'أدخل رقم الهاتف مع رمز الدولة، مثال: +971501234567',
          ),
        ),
      );
      return;
    }

    context.read<AuthBloc>().add(PhoneAuthRequested(phone));
  }

  void _verifyOtp() {
    final code = _otpController.text.trim();

    if (_verificationId == null) return;

    if (code.length < 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل رمز التحقق المكوّن من 6 أرقام')),
      );
      return;
    }

    context.read<AuthBloc>().add(
          PhoneCodeSubmitted(
            _verificationId!,
            code,
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlocConsumer<AuthBloc, AuthState>(
        listener: (context, state) {
          if (state is AuthError) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.message)),
            );
          }

          if (state is PhoneCodeSent) {
            setState(() {
              _verificationId = state.verificationId;
            });

            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('تم إرسال رمز التحقق'),
              ),
            );
          }
        },
        builder: (context, state) {
          return SafeArea(
            child: Stack(
              children: [
                SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const SizedBox(height: 70),
                      const Icon(
                        Icons.mic_rounded,
                        size: 72,
                      ),
                      const SizedBox(height: 20),
                      Text(
                        'Shadow Live',
                        textAlign: TextAlign.center,
                        style: Theme.of(context)
                            .textTheme
                            .headlineMedium
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'مرحباً بعودتك',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 35),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () {
                                setState(() {
                                  _usePhone = true;
                                  _verificationId = null;
                                });
                              },
                              icon: const Icon(Icons.phone_android),
                              label: const Text('رقم الهاتف'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () {
                                setState(() {
                                  _usePhone = false;
                                  _verificationId = null;
                                });
                              },
                              icon: const Icon(Icons.email_outlined),
                              label: const Text('البريد'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 25),
                      if (_usePhone) ...[
                        if (_verificationId == null) ...[
                          TextField(
                            controller: _phoneController,
                            keyboardType: TextInputType.phone,
                            textDirection: TextDirection.ltr,
                            decoration: const InputDecoration(
                              labelText: 'رقم الهاتف',
                              hintText: '+971501234567',
                              prefixIcon: Icon(Icons.phone_android),
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 20),
                          CustomButton(
                            text: 'إرسال رمز التحقق',
                            onPressed: _sendOtp,
                            isLoading: state is AuthLoading,
                          ),
                        ] else ...[
                          TextField(
                            controller: _otpController,
                            keyboardType: TextInputType.number,
                            textDirection: TextDirection.ltr,
                            maxLength: 6,
                            decoration: const InputDecoration(
                              labelText: 'رمز التحقق OTP',
                              hintText: '123456',
                              prefixIcon: Icon(Icons.lock_outline),
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 12),
                          CustomButton(
                            text: 'تأكيد الرمز',
                            onPressed: _verifyOtp,
                            isLoading: state is AuthLoading,
                          ),
                          const SizedBox(height: 10),
                          TextButton(
                            onPressed: () {
                              setState(() {
                                _verificationId = null;
                                _otpController.clear();
                              });
                            },
                            child: const Text(
                              'تغيير رقم الهاتف',
                            ),
                          ),
                        ],
                      ] else ...[
                        Form(
                          key: _formKey,
                          child: Column(
                            children: [
                              CustomTextField(
                                controller: _emailController,
                                label: 'Email',
                                hint: 'Enter your email',
                                keyboardType: TextInputType.emailAddress,
                                prefixIcon: const Icon(Icons.email_outlined),
                                validator: (value) {
                                  if (value == null || value.isEmpty) {
                                    return 'Please enter your email';
                                  }

                                  if (!value.contains('@')) {
                                    return 'Please enter a valid email';
                                  }

                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              CustomTextField(
                                controller: _passwordController,
                                label: 'Password',
                                hint: 'Enter your password',
                                obscureText: !_isPasswordVisible,
                                prefixIcon: const Icon(Icons.lock_outline),
                                suffixIcon: IconButton(
                                  icon: Icon(
                                    _isPasswordVisible
                                        ? Icons.visibility_off
                                        : Icons.visibility,
                                  ),
                                  onPressed: () {
                                    setState(() {
                                      _isPasswordVisible = !_isPasswordVisible;
                                    });
                                  },
                                ),
                                validator: (value) {
                                  if (value == null || value.isEmpty) {
                                    return 'Please enter your password';
                                  }

                                  if (value.length < 6) {
                                    return 'Password must be at least 6 characters';
                                  }

                                  return null;
                                },
                              ),
                              const SizedBox(height: 24),
                              CustomButton(
                                text: 'Sign In',
                                onPressed: _loginEmail,
                                isLoading: state is AuthLoading,
                              ),
                            ],
                          ),
                        ),
                      ],
                      const SizedBox(height: 30),
                      const Text(
                        'Shadow Live',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
                if (state is AuthLoading)
                  const LoadingIndicator(
                    message: 'جاري المعالجة...',
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}
