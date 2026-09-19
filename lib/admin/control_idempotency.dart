import 'package:crypto/crypto.dart';
import 'dart:convert';
abstract final class ControlIdempotency {
 static String key({required String actorUid,required String action,required String targetId,required String clientRequestId}){
  if(clientRequestId.trim().isEmpty)throw ArgumentError('clientRequestId required');
  return sha256.convert(utf8.encode('$actorUid|$action|$targetId|$clientRequestId')).toString();
 }
}
