import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class AgencyPackageAsset {
  const AgencyPackageAsset({
    required this.assetKey,
    required this.rawUrl,
    required this.mode,
  });

  final String assetKey;
  final String? rawUrl;
  final String mode;

  factory AgencyPackageAsset.fromJson(Map<String, dynamic> json) {
    return AgencyPackageAsset(
      assetKey: (json['assetKey'] ?? '').toString(),
      rawUrl: _nullable(json['rawUrl']),
      mode: (json['mode'] ?? 'remote').toString(),
    );
  }
}

class AgencyPackageLine {
  const AgencyPackageLine({
    required this.lineId,
    required this.type,
    required this.assetKey,
    required this.nameAr,
    required this.entitlementDurationHours,
    required this.quantity,
    this.imageUrl,
    this.quantityGranted = 0,
    this.quantityRemaining,
  });

  final String lineId;
  final String type;
  final String assetKey;
  final String nameAr;
  final int entitlementDurationHours;
  final int quantity;
  final String? imageUrl;
  final int quantityGranted;
  final int? quantityRemaining;

  factory AgencyPackageLine.fromJson(Map<String, dynamic> json) {
    return AgencyPackageLine(
      lineId: (json['lineId'] ?? '').toString(),
      type: (json['type'] ?? '').toString(),
      assetKey: (json['assetKey'] ?? '').toString(),
      nameAr: (json['nameAr'] ?? '').toString(),
      entitlementDurationHours: _int(json['entitlementDurationHours']),
      quantity: _int(json['quantity']),
      imageUrl: _nullable(json['imageUrl']),
      quantityGranted: _int(json['quantityGranted']),
      quantityRemaining: json['quantityRemaining'] == null
          ? null
          : _int(json['quantityRemaining']),
    );
  }

  Map<String, dynamic> toJson() => {
        'lineId': lineId,
        'type': type,
        'assetKey': assetKey,
        'nameAr': nameAr,
        'entitlementDurationHours': entitlementDurationHours,
        'quantity': quantity,
      };
}

class AgencyPackageTemplate {
  const AgencyPackageTemplate({
    required this.templateId,
    required this.name,
    required this.packageDurationHours,
    required this.status,
    required this.lineItems,
  });

  final String templateId;
  final String name;
  final int packageDurationHours;
  final String status;
  final List<AgencyPackageLine> lineItems;

  factory AgencyPackageTemplate.fromJson(Map<String, dynamic> json) {
    final raw = json['lineItems'];
    return AgencyPackageTemplate(
      templateId: (json['templateId'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      packageDurationHours: _int(json['packageDurationHours']),
      status: (json['status'] ?? 'active').toString(),
      lineItems: raw is List
          ? raw
              .whereType<Map>()
              .map((item) => AgencyPackageLine.fromJson(
                    Map<String, dynamic>.from(item),
                  ))
              .toList(growable: false)
          : const <AgencyPackageLine>[],
    );
  }
}

class AgencyPackageGrant {
  const AgencyPackageGrant({
    required this.grantId,
    required this.templateId,
    required this.templateName,
    required this.expiresAtMs,
    required this.expired,
    required this.status,
    required this.items,
  });

  final String grantId;
  final String templateId;
  final String templateName;
  final int expiresAtMs;
  final bool expired;
  final String status;
  final List<AgencyPackageLine> items;

  factory AgencyPackageGrant.fromJson(Map<String, dynamic> json) {
    final raw = json['items'];
    return AgencyPackageGrant(
      grantId: (json['grantId'] ?? '').toString(),
      templateId: (json['templateId'] ?? '').toString(),
      templateName: (json['templateName'] ?? '').toString(),
      expiresAtMs: _int(json['expiresAtMs']),
      expired: json['expired'] == true,
      status: (json['status'] ?? '').toString(),
      items: raw is List
          ? raw
              .whereType<Map>()
              .map((item) => AgencyPackageLine.fromJson(
                    Map<String, dynamic>.from(item),
                  ))
              .toList(growable: false)
          : const <AgencyPackageLine>[],
    );
  }
}

class AgencyPackageService {
  AgencyPackageService({
    http.Client? client,
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final bool _ownsClient;
  final FirebaseAuth _auth;
  final String _baseUrl;

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/agency-packages'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 25));

    Map<String, dynamic> decoded = const <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map) decoded = Map<String, dynamic>.from(value);
    } catch (_) {}
    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'agency_package_request_failed').toString(),
      );
    }
    return decoded;
  }

  Future<List<AgencyPackageAsset>> loadAssets() async {
    final body = await _post(const {'action': 'listAssets'});
    final raw = body['assets'];
    return raw is List
        ? raw
            .whereType<Map>()
            .map((item) => AgencyPackageAsset.fromJson(
                  Map<String, dynamic>.from(item),
                ))
            .toList(growable: false)
        : const <AgencyPackageAsset>[];
  }

  Future<List<AgencyPackageTemplate>> loadTemplates() async {
    final body = await _post(const {'action': 'listTemplates'});
    final raw = body['templates'];
    return raw is List
        ? raw
            .whereType<Map>()
            .map((item) => AgencyPackageTemplate.fromJson(
                  Map<String, dynamic>.from(item),
                ))
            .toList(growable: false)
        : const <AgencyPackageTemplate>[];
  }

  Future<AgencyPackageTemplate> saveTemplate({
    String? templateId,
    required String name,
    required int packageDurationHours,
    required List<AgencyPackageLine> lineItems,
    required String idempotencyKey,
  }) async {
    final body = await _post({
      'action': 'saveTemplate',
      if (templateId != null && templateId.trim().isNotEmpty)
        'templateId': templateId.trim(),
      'name': name.trim(),
      'packageDurationHours': packageDurationHours,
      'lineItems': lineItems.map((item) => item.toJson()).toList(),
      'idempotencyKey': idempotencyKey,
    });
    return AgencyPackageTemplate.fromJson(body);
  }

  Future<AgencyPackageTemplate> duplicateTemplate({
    required String sourceTemplateId,
    required String name,
    required String idempotencyKey,
  }) async {
    final body = await _post({
      'action': 'duplicateTemplate',
      'sourceTemplateId': sourceTemplateId.trim(),
      'name': name.trim(),
      'idempotencyKey': idempotencyKey,
    });
    return AgencyPackageTemplate.fromJson(body);
  }

  Future<void> archiveTemplate({
    required String templateId,
    required String idempotencyKey,
  }) async {
    await _post({
      'action': 'archiveTemplate',
      'templateId': templateId.trim(),
      'idempotencyKey': idempotencyKey,
    });
  }

  Future<String> grantPackage({
    required String templateId,
    required String agencyId,
    required String idempotencyKey,
  }) async {
    final body = await _post({
      'action': 'grantPackage',
      'templateId': templateId.trim(),
      'agencyId': agencyId.trim(),
      'idempotencyKey': idempotencyKey,
    });
    return (body['grantId'] ?? '').toString();
  }

  Future<List<AgencyPackageGrant>> loadMyPackages() async {
    final body = await _post(const {'action': 'myPackages', 'limit': 25});
    final raw = body['packages'];
    return raw is List
        ? raw
            .whereType<Map>()
            .map((item) => AgencyPackageGrant.fromJson(
                  Map<String, dynamic>.from(item),
                ))
            .toList(growable: false)
        : const <AgencyPackageGrant>[];
  }

  Future<int> distribute({
    required String grantId,
    required String lineId,
    required String targetPublicId,
    required String idempotencyKey,
  }) async {
    final body = await _post({
      'action': 'distribute',
      'grantId': grantId.trim(),
      'lineId': lineId.trim(),
      'targetPublicId': targetPublicId.trim(),
      'idempotencyKey': idempotencyKey,
    });
    return _int(body['quantityRemaining']);
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

int _int(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse((value ?? '').toString()) ?? 0;
}

String? _nullable(dynamic value) {
  final text = (value ?? '').toString().trim();
  return text.isEmpty ? null : text;
}
