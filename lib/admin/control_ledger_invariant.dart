abstract final class LedgerInvariant {
 static bool balancesMatch({required num opening,required Iterable<num> deltas,required num closing}){
  final expected=deltas.fold<num>(opening,(sum,x)=>sum+x);
  return expected==closing;
 }
 static void requireBalanced({required num opening,required Iterable<num> deltas,required num closing}){
  if(!balancesMatch(opening:opening,deltas:deltas,closing:closing))throw StateError('ledger/balance mismatch');
 }
}
