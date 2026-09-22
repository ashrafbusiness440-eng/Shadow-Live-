class ControlDevice {
 const ControlDevice({required this.id,required this.label,required this.known,required this.lastSeenAt});
 final String id,label; final bool known; final DateTime lastSeenAt;
 bool get requiresSecurityAlert=>!known;
}
