class FinancialEvent {
 const FinancialEvent({required this.type,required this.userId,required this.asset,required this.amount,required this.sourceId,required this.idempotencyKey});
 final String type,userId,asset,sourceId,idempotencyKey; final num amount;
 static const supportedTypes={'recharge','gift','selfGift','withdrawal','refund','adminAdjustment','diamondConversion','diamondGift','agencySettlement'};
 void validate(){
  if(!supportedTypes.contains(type))throw ArgumentError('unsupported financial event');
  if(!{'coins','diamonds'}.contains(asset))throw ArgumentError('unsupported asset');
  if(amount<=0)throw ArgumentError('amount must be positive');
  if(userId.trim().isEmpty||sourceId.trim().isEmpty||idempotencyKey.trim().isEmpty)throw ArgumentError('financial identifiers required');
 }
}
