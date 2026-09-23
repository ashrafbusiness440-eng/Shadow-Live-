class ControlTransaction {
 const ControlTransaction({required this.idempotencyKey,required this.actorUid,required this.userId,required this.asset,required this.delta,required this.reason,required this.action});
 final String idempotencyKey,actorUid,userId,asset,reason,action; final num delta;
 Map<String,dynamic> ledgerData()=>{'idempotencyKey':idempotencyKey,'actorUid':actorUid,'userId':userId,'asset':asset,'delta':delta,'reason':reason,'action':action};
 void validate(){
  if(!{'coins','diamonds'}.contains(asset))throw ArgumentError('unsupported asset');
  if(delta==0)throw ArgumentError('delta cannot be zero');
  if(reason.trim().length<3)throw ArgumentError('reason required');
 }
}
