String setupDestination(Map<String, dynamic>? userData) {
  final data = userData ?? const <String, dynamic>{};
  final setupComplete = data['setupComplete'] == true;
  final setupStep = data['setupStep']?.toString();
  if (setupComplete) return '/main';

  return switch (setupStep) {
    'success' => '/account-success',
    'linking' => '/account-linking',
    'ready' => '/account-ready',
    'complete' || 'completed' => '/main',
    'profile' || null => '/profile-setup',
    _ => '/profile-setup',
  };
}
