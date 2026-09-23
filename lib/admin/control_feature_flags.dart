class ControlFeatureFlags {
 const ControlFeatureFlags({this.financialWrites=false,this.roleMutations=false,this.gameRng=false,this.purchaseVerification=false});
 final bool financialWrites,roleMutations,gameRng,purchaseVerification;
 bool get productionReady=>financialWrites&&roleMutations&&gameRng&&purchaseVerification;
 static const safeDefault=ControlFeatureFlags();
}
