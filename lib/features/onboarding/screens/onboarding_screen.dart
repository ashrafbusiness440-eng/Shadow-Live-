import 'dart:async';

import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _controller = PageController();
  int _current = 0;
  Timer? _autoTimer;

  static const _gold = Color(0xFFFFD54A);
  static const _purple = Color(0xFF8A00FF);
  static const _pink = Color(0xFFFF00FF);

  final List<_PageData> _pages = const [
    _PageData(
      image: 'assets/images/onboarding_voice.png',
      title: 'غرف صوتية حية',
      subtitle: 'تحدث، استمع، تعرّف على أصدقاء\nمن جميع أنحاء العالم',
    ),
    _PageData(
      image: 'assets/images/onboarding_gifts.png',
      title: 'هدايا ومكافآت',
      subtitle: 'ادعم من تحب بالهدايا وكن جزءاً\nمن اللحظات المميزة',
    ),
    _PageData(
      image: 'assets/images/onboarding_games.png',
      title: 'ألعاب وتحديات',
      subtitle: 'استمتع بألعاب جماعية وفعاليات\nممتعة يومياً',
    ),
    _PageData(
      image: 'assets/images/onboarding_community.png',
      title: 'مجتمعك بانتظارك',
      subtitle: 'انضم إلى مجتمع Shadow Live\nواصنع قصتك الخاصة',
    ),
  ];

  @override
  void initState() {
    super.initState();
    _startAutoTimer();
  }

  void _startAutoTimer() {
    _autoTimer?.cancel();
    _autoTimer = Timer(const Duration(seconds: 8), () {
      if (!mounted) return;
      _next();
    });
  }

  void _onPageChanged(int index) {
    setState(() => _current = index);
    _startAutoTimer();
  }

  void _finish() {
    _autoTimer?.cancel();
    Navigator.of(context).pushReplacementNamed(AppRoutes.authChoice);
  }

  void _next() {
    _autoTimer?.cancel();
    if (_current == _pages.length - 1) {
      _finish();
      return;
    }

    _controller.nextPage(
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOutCubic,
    );
  }

  void _back() {
    if (_current <= 0) return;
    _autoTimer?.cancel();
    _controller.previousPage(
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  void dispose() {
    _autoTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          PageView.builder(
            controller: _controller,
            itemCount: _pages.length,
            onPageChanged: _onPageChanged,
            itemBuilder: (context, index) {
              final page = _pages[index];
              return Stack(
                fit: StackFit.expand,
                children: [
                  Image.asset(
                    page.image,
                    width: double.infinity,
                    height: double.infinity,
                    fit: BoxFit.cover,
                    alignment: Alignment.topCenter,
                  ),

                  // The artwork is visual only. This lower overlay deliberately
                  // masks any legacy baked-in labels/dots in older image assets.
                  Align(
                    alignment: Alignment.bottomCenter,
                    child: FractionallySizedBox(
                      widthFactor: 1,
                      heightFactor: .53,
                      child: DecoratedBox(
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Color(0x00000000),
                              Color(0xE6080711),
                              Color(0xFF02040B),
                              Color(0xFF02040B),
                            ],
                            stops: [0, .18, .42, 1],
                          ),
                        ),
                      ),
                    ),
                  ),

                  SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(24, 0, 24, 120),
                      child: Column(
                        children: [
                          const Spacer(flex: 7),
                          Text(
                            page.title,
                            textDirection: TextDirection.rtl,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: _gold,
                              fontSize: 28,
                              fontWeight: FontWeight.w900,
                              height: 1.2,
                              shadows: [
                                Shadow(
                                  color: Color(0x99000000),
                                  blurRadius: 14,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            page.subtitle,
                            textDirection: TextDirection.rtl,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Color(0xFFE7E7EF),
                              fontSize: 17,
                              height: 1.55,
                              fontWeight: FontWeight.w500,
                              shadows: [
                                Shadow(
                                  color: Color(0xCC000000),
                                  blurRadius: 12,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 18),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: List.generate(
                              _pages.length,
                              (dotIndex) => AnimatedContainer(
                                duration: const Duration(milliseconds: 250),
                                margin:
                                    const EdgeInsets.symmetric(horizontal: 2.5),
                                width: dotIndex == _current ? 13 : 5,
                                height: 5,
                                decoration: BoxDecoration(
                                  color: dotIndex == _current
                                      ? _gold
                                      : Colors.white30,
                                  borderRadius: BorderRadius.circular(20),
                                ),
                              ),
                            ),
                          ),
                          const Spacer(flex: 1),
                        ],
                      ),
                    ),
                  ),
                ],
              );
            },
          ),

          SafeArea(
            child: Align(
              alignment: AlignmentDirectional.topEnd,
              child: Padding(
                padding: const EdgeInsets.only(top: 6, right: 10, left: 10),
                child: TextButton(
                  onPressed: _finish,
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.white,
                    backgroundColor: const Color(0x66000000),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  ),
                  child: const Text(
                    'تخطي',
                    textDirection: TextDirection.rtl,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          ),

          if (_current > 0)
            SafeArea(
              child: Align(
                alignment: AlignmentDirectional.topStart,
                child: Padding(
                  padding: const EdgeInsets.only(top: 7, right: 12, left: 12),
                  child: Material(
                    color: const Color(0x66000000),
                    shape: const CircleBorder(),
                    child: IconButton(
                      onPressed: _back,
                      tooltip: 'رجوع',
                      icon: const Icon(
                        Icons.arrow_back_ios_new_rounded,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                  ),
                ),
              ),
            ),

          SafeArea(
            child: Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Container(
                  width: double.infinity,
                  height: 56,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    gradient: const LinearGradient(
                      colors: [_purple, _pink],
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x668A00FF),
                        blurRadius: 18,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: _next,
                      borderRadius: BorderRadius.circular(16),
                      child: Center(
                        child: Text(
                          _current == _pages.length - 1 ? 'ابدأ الآن' : 'التالي',
                          textDirection: TextDirection.rtl,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PageData {
  final String image;
  final String title;
  final String subtitle;

  const _PageData({
    required this.image,
    required this.title,
    required this.subtitle,
  });
}
