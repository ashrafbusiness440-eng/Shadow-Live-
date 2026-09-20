import 'dart:convert';
import 'package:http/http.dart' as http;
import 'control_server_contract.dart';
import 'control_backend_status.dart';
import 'control_health.dart';
import 'control_runtime_gate.dart';

class ControlApiClient {
 ControlApiClient({required this.baseUri,required this.idTokenProvider,http.Client? client}):_client=client??http.Client();
 final Uri baseUri; final Future<String> Function() idTokenProvider; final http.Client _client;

 Future<Map<String,dynamic>> _getHealth() async {
  final response=await _client.get(baseUri.resolve('/v1/control/health'));
  if(response.statusCode<200||response.statusCode>=300)throw StateError('Control health unavailable: ${response.statusCode}');
  final decoded=jsonDecode(response.body);
  if(decoded is! Map<String,dynamic>)throw StateError('Invalid control health response');
  return decoded;
 }
 Future<ControlBackendStatus> backendStatus() async=>ControlBackendStatus.fromJson(await _getHealth());
 Future<ControlHealth> health() async=>ControlHealth.fromJson(await _getHealth());
 Future<ControlRuntimeGate> runtimeGate() async {
  final snapshot=await _getHealth();
  return ControlRuntimeGate(
   backend:ControlBackendStatus.fromJson(snapshot),
   health:ControlHealth.fromJson(snapshot),
  );
 }

 Future<TrustedServerResponse> execute(TrustedServerRequest request) async {
  final token=await idTokenProvider();
  if(token.trim().isEmpty)throw StateError('Firebase ID token required');
  final response=await _client.post(
   baseUri.resolve('/v1/control/actions'),
   headers:{'authorization':'Bearer $token','content-type':'application/json'},
   body:jsonEncode(request.toJson()),
  );
  Map<String,dynamic> body={};
  if(response.body.isNotEmpty){final decoded=jsonDecode(response.body);if(decoded is Map<String,dynamic>)body=decoded;}
  if(response.statusCode<200||response.statusCode>=300){
   return TrustedServerResponse(ok:false,code:'${body['code']??'http_${response.statusCode}'}',message:body['message']?.toString());
  }
  return TrustedServerResponse.fromJson(body);
 }
 void close()=>_client.close();
}
