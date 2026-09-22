import 'control_config.dart';
abstract final class RechargePolicy {
 static int? coinsForPackage(num usd)=>ControlConfig.rechargePackages[usd.toDouble()];
 static void validatePackage(num usd){if(coinsForPackage(usd)==null)throw ArgumentError('unknown recharge package');}
 static bool get clientMayCreditBalance=>false;
 static bool get requiresServerPurchaseVerification=>true;
}
