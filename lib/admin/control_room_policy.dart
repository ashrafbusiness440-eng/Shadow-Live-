abstract final class RoomPolicy {
 static int seats({required int level,required bool agency}) {
  final table=agency?const [10,12,14,16,20,22]:const [8,10,12,15,20,20];
  if(level<1||level>6)throw ArgumentError('room level must be 1..6'); return table[level-1];
 }
 static int moderators({required int level,required bool agency}) {
  final table=agency?const [5,6,7,9,11,14]:const [3,4,5,7,9,12];
  if(level<1||level>6)throw ArgumentError('room level must be 1..6'); return table[level-1];
 }
 static const hiddenRoomCapability='canCreateHiddenRoom';
 static const globalControlCapability='globalRoomControl';
}
