class FinancialReservation {
 const FinancialReservation({required this.available,required this.reserved});
 final num available,reserved;
 num get total=>available+reserved;
 FinancialReservation reserve(num amount){
  if(amount<=0)throw ArgumentError('amount must be positive');
  if(amount>available)throw StateError('insufficient available balance');
  return FinancialReservation(available:available-amount,reserved:reserved+amount);
 }
 FinancialReservation release(num amount){
  if(amount<=0||amount>reserved)throw StateError('invalid reserved amount');
  return FinancialReservation(available:available+amount,reserved:reserved-amount);
 }
 FinancialReservation settle(num amount){
  if(amount<=0||amount>reserved)throw StateError('invalid settlement amount');
  return FinancialReservation(available:available,reserved:reserved-amount);
 }
}
