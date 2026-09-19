abstract final class ModerationAction {
 static const warning='warning', mute='mute', messageBan='messageBan', roomBan='roomBan',
  suspend='suspend', permanentBan='permanentBan';
 static const supported={warning,mute,messageBan,roomBan,suspend,permanentBan};
 static void validate({required String action,required String reason,Duration? duration}){
  if(!supported.contains(action))throw ArgumentError('unsupported moderation action');
  if(reason.trim().length<3)throw ArgumentError('reason required');
  if(action!=warning&&action!=permanentBan&&(duration==null||duration<=Duration.zero))throw ArgumentError('duration required');
 }
}
