abstract final class UserLevelPolicy {
 static const maxLevel=100;
 static int cappedXp({required int earned,required int dailyCap}){
  if(earned<0||dailyCap<0)throw ArgumentError('xp cannot be negative');
  return earned>dailyCap?dailyCap:earned;
 }
 static bool canDecreaseLevel=>false;
}
