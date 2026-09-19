class EmergencyLockState {
 const EmergencyLockState({required this.enabled,this.reason,this.activatedBy,this.activatedAt});
 final bool enabled; final String? reason,activatedBy; final DateTime? activatedAt;
 bool get blocksSensitiveWrites=>enabled;
 factory EmergencyLockState.fromMap(Map<String,dynamic>? x)=>EmergencyLockState(enabled:x?['enabled']==true,reason:x?['reason']?.toString(),activatedBy:x?['activatedBy']?.toString());
}
