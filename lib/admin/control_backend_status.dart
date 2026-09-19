class ControlBackendStatus {
 const ControlBackendStatus({required this.reachable,required this.environment,required this.version,required this.financialWritesEnabled,required this.roleMutationsEnabled});
 final bool reachable,financialWritesEnabled,roleMutationsEnabled; final String environment,version;
 bool get privilegedReady=>reachable&&environment!='demo'&&financialWritesEnabled&&roleMutationsEnabled;
 factory ControlBackendStatus.fromJson(Map<String,dynamic> x)=>ControlBackendStatus(
  reachable:true,environment:'${x['environment']??'unknown'}',version:'${x['version']??'unknown'}',
  financialWritesEnabled:x['financialWritesEnabled']==true,roleMutationsEnabled:x['roleMutationsEnabled']==true,
 );
}
