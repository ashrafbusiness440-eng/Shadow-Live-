class CapabilityChange {
 const CapabilityChange({required this.targetUid,required this.capability,required this.enabled,required this.reason});
 final String targetUid,capability,reason; final bool enabled;
 void validate(){
  if(targetUid.trim().isEmpty||capability.trim().isEmpty)throw ArgumentError('target and capability required');
  if(reason.trim().length<3)throw ArgumentError('reason required');
 }
 Map<String,dynamic> toJson()=>{'targetUid':targetUid,'capability':capability,'enabled':enabled,'reason':reason};
}
