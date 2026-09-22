import 'control_action_catalog.dart';
import 'control_action_request.dart';
import 'control_api_client.dart';
import 'control_idempotency.dart';
import 'control_request_validator.dart';
import 'control_server_contract.dart';
import 'control_runtime_gate.dart';

class ControlService {
 ControlService(this.api); final ControlApiClient api;
 Future<ControlRuntimeGate> runtimeGate()=>api.runtimeGate();
 Future<TrustedServerResponse> execute({
  required String actorUid,required String action,required String targetType,required String targetId,
  required String reason,required String clientRequestId,Map<String,dynamic> payload=const {},
 }) async {
  final definition=ControlActionCatalog.get(action);
  if(definition.financial||definition.sensitive){
   final gate=await runtimeGate();
   gate.requirePrivileged();
  }
  final nextPayload=Map<String,dynamic>.from(payload);
  if(definition.financial||definition.sensitive){
   nextPayload['idempotencyKey']=ControlIdempotency.key(actorUid:actorUid,action:action,targetId:targetId,clientRequestId:clientRequestId);
  }
  final local=ControlActionRequest(action:action,targetType:targetType,targetId:targetId,reason:reason,payload:nextPayload);
  ControlRequestValidator.validate(local);
  return api.execute(TrustedServerRequest(action:action,targetId:targetId,reason:reason,clientRequestId:clientRequestId,payload:{'targetType':targetType,...nextPayload}));
 }
}
