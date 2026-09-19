import 'control_action_catalog.dart';
import 'control_action_request.dart';
abstract final class ControlRequestValidator {
 static ControlActionDefinition validate(ControlActionRequest request){
  request.validate();
  final definition=ControlActionCatalog.get(request.action);
  if((definition.financial||definition.sensitive)&&!request.payload.containsKey('idempotencyKey'))throw ArgumentError('sensitive action requires idempotencyKey');
  return definition;
 }
}
