class PurchaseVerification {
 const PurchaseVerification({required this.productId,required this.purchaseToken,required this.userId});
 final String productId,purchaseToken,userId;
 void validate(){
  if(productId.trim().isEmpty||purchaseToken.trim().isEmpty||userId.trim().isEmpty)throw ArgumentError('purchase verification fields required');
 }
 static bool clientResultIsAuthoritative=>false;
 static bool requiresServerVerification=>true;
}
