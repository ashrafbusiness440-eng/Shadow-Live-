const String shadowApiBaseUrl = String.fromEnvironment(
  'SHADOW_API_BASE_URL',
  defaultValue: 'https://shadow-live-six.vercel.app/api',
);

Uri shadowApiEndpoint(
  String endpoint, {
  Map<String, String>? queryParameters,
}) {
  final cleanBase = shadowApiBaseUrl.endsWith('/')
      ? shadowApiBaseUrl.substring(0, shadowApiBaseUrl.length - 1)
      : shadowApiBaseUrl;
  final cleanEndpoint = endpoint.startsWith('/')
      ? endpoint.substring(1)
      : endpoint;
  return Uri.parse('$cleanBase/$cleanEndpoint')
      .replace(queryParameters: queryParameters);
}

Uri shadowEconomyEndpoint(String route) => shadowApiEndpoint(
      'economy-router',
      queryParameters: <String, String>{'route': route},
    );
