const String shadowCloudflareApiBaseUrl = String.fromEnvironment(
  'SHADOW_CLOUDFLARE_API_BASE_URL',
  defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
);

Uri shadowApiEndpoint(
  String endpoint, {
  Map<String, String>? queryParameters,
}) {
  final cleanEndpoint = endpoint.startsWith('/')
      ? endpoint.substring(1)
      : endpoint;
  final cleanBase = shadowCloudflareApiBaseUrl.endsWith('/')
      ? shadowCloudflareApiBaseUrl.substring(
          0,
          shadowCloudflareApiBaseUrl.length - 1,
        )
      : shadowCloudflareApiBaseUrl;
  return Uri.parse('$cleanBase/$cleanEndpoint')
      .replace(queryParameters: queryParameters);
}

Uri shadowEconomyEndpoint(String route) => shadowApiEndpoint(
      'economy-router',
      queryParameters: <String, String>{'route': route},
    );
