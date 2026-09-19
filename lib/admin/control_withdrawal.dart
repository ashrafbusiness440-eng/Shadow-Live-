abstract final class WithdrawalPolicy {
 static const statuses={'pending','under_review','approved','paid','rejected','disputed'};
 static void validateRequest({required num available,required num amount,required num minimum}) {
  if(amount<minimum)throw ArgumentError('below minimum withdrawal');
  if(amount>available)throw ArgumentError('insufficient available diamonds');
 }
 static bool canTransition(String from,String to){
  const m=<String,Set<String>>{
   'pending':{'under_review','rejected'},'under_review':{'approved','rejected'},
   'approved':{'paid','disputed'},'paid':{'disputed'},'rejected':{},'disputed':{'paid','rejected'},
  };
  return m[from]?.contains(to)??false;
 }
}
