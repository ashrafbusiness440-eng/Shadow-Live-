class ControlEventPolicy {
 static const types={'mission','seasonal','ranking','room','agency','game'};
 static const rewardAssets={'coins','userXp','cosmetic','specialId'};
 static void validate({required String type,required DateTime startsAt,required DateTime endsAt}){
  if(!types.contains(type))throw ArgumentError('unsupported event type');
  if(!endsAt.isAfter(startsAt))throw ArgumentError('event end must follow start');
 }
}
