class ControlAccess {
  const ControlAccess({required this.uid,required this.role,required this.capabilities,this.enabled=true});
  final String uid, role; final Set<String> capabilities; final bool enabled;
  bool get isOwner=>role=='owner';
  bool can(String capability)=>enabled&&(isOwner||capabilities.contains(capability));
  factory ControlAccess.fromMap(String uid,Map<String,dynamic> data)=>ControlAccess(
    uid:uid,role:(data['role']??'user').toString(),
    capabilities:Set<String>.from((data['capabilities'] as List?)?.map((e)=>e.toString())??const []),
    enabled:data['adminEnabled']!=false,
  );
}
