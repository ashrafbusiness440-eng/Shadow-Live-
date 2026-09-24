const String shadowLegacyApiBaseUrl = String.fromEnvironment(
  'SHADOW_API_BASE_URL',
  defaultValue: 'https://shadow-live-six.vercel.app/api',
);

const String shadowCloudflareApiBaseUrl = String.fromEnvironment(
  'SHADOW_CLOUDFLARE_API_BASE_URL',
  defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
);

const Set<String> _cloudflareMigratedEndpoints = <String>{
  'adjust-balance',
  'change-public-id',
  'set-id-management-permission',
  'economy-router',
};

Uri shadowApiEndpoint(
  String endpoint, {
  Map<String, String>? queryParameters,
}) {
  final cleanEndpoint = endpoint.startsWith('/')
      ? endpoint.substring(1)
      : endpoint;
  final selectedBase = _cloudflareMigratedEndpoints.contains(cleanEndpoint)
      ? shadowCloudflareApiBaseUrl
      : shadowLegacyApiBaseUrl;
  final cleanBase = selectedBase.endsWith('/')
      ? selectedBase.substring(0, selectedBase.length - 1)
      : selectedBase;
  return Uri.parse('$cleanBase/$cleanEndpoint')
      .replace(queryParameters: queryParameters);
}

Uri shadowEconomyEndpoint(String route) => shadowApiEndpoint(
      'economy-router',
      queryParameters: <String, String>{'route': route},
    );
