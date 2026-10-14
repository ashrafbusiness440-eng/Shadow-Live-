import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img;

/// Captures the *visible report surface*, never the entire device screen.
/// The server labels this as unverified user-provided visual evidence;
/// authoritative chat/room facts are collected independently on the server.
/// Failing to capture or attach MUST NOT block a genuine report.
Future<String?> captureReportSnapshot(GlobalKey boundaryKey) async {
  try {
    final render = boundaryKey.currentContext?.findRenderObject();
    if (render is! RenderRepaintBoundary || render.debugNeedsPaint) {
      return null;
    }
    final shot = await render.toImage(pixelRatio: 1);
    try {
      final data = await shot.toByteData(format: ui.ImageByteFormat.png);
      if (data == null) return null;
      final decoded = img.decodePng(data.buffer.asUint8List());
      if (decoded == null) return null;
      for (final width in <int>[640, 520, 420]) {
        final target = decoded.width > width
            ? img.copyResize(decoded, width: width)
            : decoded;
        for (final quality in <int>[67, 52, 40]) {
          final jpeg = Uint8List.fromList(img.encodeJpg(target, quality: quality));
          if (jpeg.length <= 150000) return base64Encode(jpeg);
        }
      }
    } finally {
      shot.dispose();
    }
  } catch (_) {
    // Screen capture is best-effort. Reports stay available without images.
  }
  return null;
}

class ReportScreenshotService {
  static const _baseUrl = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  /// Fire-and-forget at the CALL SITE, but bounded and awaited inside.
  /// Returns whether the optional proof was actually attached.
  Future<bool> attach({
    required String reportId,
    required String? imageBase64,
  }) async {
    if (reportId.trim().isEmpty || imageBase64 == null ||
        imageBase64.isEmpty) return false;
    try {
      final token = await FirebaseAuth.instance.currentUser?.getIdToken();
      if (token == null || token.isEmpty) return false;
      final response = await http.post(
        Uri.parse('$_baseUrl/report-screenshot'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': 'attach',
          'reportId': reportId,
          'imageBase64': imageBase64,
        }),
      ).timeout(const Duration(seconds: 12));
      if (response.statusCode != 200) return false;
      final result = jsonDecode(response.body);
      return result is Map && result['ok'] == true &&
          result['screenshotAttached'] == true;
    } catch (_) {
      return false;
    }
  }
}
