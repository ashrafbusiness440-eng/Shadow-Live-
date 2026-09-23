import 'control_backend_status.dart';
import 'control_health.dart';
class ControlRuntimeGate {
 const ControlRuntimeGate({required this.backend,required this.health});
 final ControlBackendStatus backend; final ControlHealth health;
 bool get readOnlyReady=>backend.reachable&&health.api&&health.auth&&health.firestore;
 bool get privilegedReady=>readOnlyReady&&health.audit&&health.ledger&&backend.privilegedReady;
 void requirePrivileged(){if(!privilegedReady)throw StateError('Control backend is not ready for privileged operations');}
}
