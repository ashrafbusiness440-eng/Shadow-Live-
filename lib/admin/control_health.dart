class ControlHealth {
 const ControlHealth({required this.api,required this.firestore,required this.auth,required this.audit,required this.ledger});
 final bool api,firestore,auth,audit,ledger;
 bool get coreHealthy=>api&&firestore&&auth&&audit&&ledger;
 factory ControlHealth.fromJson(Map<String,dynamic> x)=>ControlHealth(api:x['api']==true,firestore:x['firestore']==true,auth:x['auth']==true,audit:x['audit']==true,ledger:x['ledger']==true);
}
