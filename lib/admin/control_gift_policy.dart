abstract final class GiftPolicy {
 static const categories={'general','countries','celebrities','vip','lucky','activities'};
 static const countryFlagInitialCoins=500;
 static const globalBannerThresholdCoins=50000;
 static const sendMultipliers={1,7,77,777};
 static int totalCost({required int unitCoins,required int quantity}){
  if(unitCoins<=0||quantity<=0)throw ArgumentError('positive values required');
  return unitCoins*quantity;
 }
 static bool globalBanner(int totalCoins)=>totalCoins>=globalBannerThresholdCoins;
}
