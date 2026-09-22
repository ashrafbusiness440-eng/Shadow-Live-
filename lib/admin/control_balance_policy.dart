abstract final class ControlBalancePolicy {
 static num nextBalance({required num current,required num delta}){
  final next=current+delta;
  if(next<0)throw StateError('الرصيد لا يمكن أن يصبح سالبًا');
  return next;
 }
 static bool isWithdrawalAllowed({required num availableDiamonds,required num amount,required num minimum}){
  return amount>=minimum&&amount<=availableDiamonds;
 }
}
