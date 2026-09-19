abstract final class WalletSecurityPolicy {
 static const sensitiveActions={'withdraw','convertDiamonds','giftDiamonds'};
 static bool requiresWalletPassword(String action)=>sensitiveActions.contains(action);
 static bool storePlaintextPassword=>false;
}
