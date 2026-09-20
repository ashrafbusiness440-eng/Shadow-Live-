String setupDestination(Map<String, dynamic>? userData) {
  final data = userData ?? const <String, dynamic>{};
  final setupComplete = data['setupComplete'] == true;
  final setupStep = data['setupStep'] as String?;

  return switch (setupStep) {
    'success' => '/account-success',
    'linking' => '/account-linking',
    'ready' => '/account-ready',
    'complete' || 'completed' => '/main',
    'profile' || null => setupComplete ? '/main' : '/profile-setup',
    _ => '/profile-setup',
  };
}
