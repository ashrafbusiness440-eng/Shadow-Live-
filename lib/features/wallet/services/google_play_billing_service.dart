import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:in_app_purchase/in_app_purchase.dart';

class GooglePlayBillingService {
  GooglePlayBillingService._();

  static final InAppPurchase _iap = InAppPurchase.instance;
  static final FirebaseAuth _auth = FirebaseAuth.instance;
  static final http.Client _client = http.Client();

  static const String _baseUrl = String.fromEnvironment(
    'SHADOW_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  static bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  static Stream<List<PurchaseDetails>> get purchaseStream =>
      _iap.purchaseStream;

  static Future<ProductDetails> loadProduct(String productId) async {
    if (!supported) {
      throw StateError('Google Play Billing متاح داخل تطبيق Android فقط.');
    }

    final available = await _iap.isAvailable();
    if (!available) {
      throw StateError('Google Play Billing غير متاح على هذا الجهاز.');
    }

    final response = await _iap.queryProductDetails(<String>{productId});
    if (response.error != null) {
      throw StateError(
        response.error?.message ?? 'تعذر تحميل منتج Google Play.',
      );
    }
    if (response.productDetails.isEmpty) {
      throw StateError(
        'المنتج غير موجود في Google Play Console: ' + productId,
      );
    }
    return response.productDetails.first;
  }

  static Future<bool> buy(ProductDetails product) async {
    final user = _auth.currentUser;
    if (user == null || user.isAnonymous) {
      throw StateError('يجب تسجيل الدخول بحساب لإجراء عملية الشحن.');
    }

    final accountId = sha256.convert(utf8.encode(user.uid)).toString();
    final param = PurchaseParam(
      productDetails: product,
      applicationUserName: accountId,
    );

    return _iap.buyConsumable(
      purchaseParam: param,
      autoConsume: false,
    );
  }

  static Future<Map<String, dynamic>> verifyAndCredit(
    PurchaseDetails purchase,
  ) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw StateError('انتهت جلسة تسجيل الدخول.');
    }
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw StateError('تعذر قراءة جلسة تسجيل الدخول.');
    }

    final purchaseToken =
        purchase.verificationData.serverVerificationData.trim();
    if (purchaseToken.isEmpty) {
      throw StateError('Google Play لم يرسل Purchase Token صالح.');
    }

    final response = await _client.post(
      Uri.parse('$_baseUrl/google-play-purchase'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'productId': purchase.productID,
        'purchaseToken': purchaseToken,
      }),
    );

    Map<String, dynamic> body = <String, dynamic>{};
    try {
      body = Map<String, dynamic>.from(
        jsonDecode(response.body) as Map,
      );
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      final code = (body['code'] ?? 'play_verification_failed').toString();
      throw StateError(_messageFor(code));
    }

    if (purchase.pendingCompletePurchase) {
      try {
        await _iap.completePurchase(purchase);
      } catch (_) {
        // Server-side consume is authoritative. A later purchase-stream
        // delivery can retry completion without crediting twice.
      }
    }

    return body;
  }

  static String _messageFor(String code) {
    switch (code) {
      case 'purchase_pending':
        return 'عملية الدفع ما زالت معلقة في Google Play.';
      case 'purchase_not_valid':
        return 'تعذر اعتماد عملية الشراء من Google Play.';
      case 'product_mismatch':
      case 'unknown_product':
        return 'منتج الشحن لا يطابق الباقات المعتمدة.';
      case 'account_mismatch':
        return 'عملية الشراء مرتبطة بحساب مختلف.';
      case 'purchase_already_consumed':
        return 'Purchase Token مستخدم أو مستهلك مسبقاً.';
      case 'emergency_locked':
        return 'عمليات الشحن متوقفة مؤقتاً.';
      case 'account_required':
        return 'يجب استخدام حساب مسجل لإجراء عملية الشحن.';
      default:
        return 'تعذر التحقق من عملية Google Play حالياً.';
    }
  }
}
