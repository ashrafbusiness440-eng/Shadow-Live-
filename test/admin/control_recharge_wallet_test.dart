import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_recharge.dart';
import 'package:voice_chat_room/admin/control_wallet_security.dart';
import 'package:voice_chat_room/admin/control_user_level.dart';
import 'package:voice_chat_room/admin/control_agency_removal.dart';
void main(){
 test('recharge packages are server verified',(){expect(RechargePolicy.coinsForPackage(9.99),125000);expect(RechargePolicy.clientMayCreditBalance,isFalse);expect(RechargePolicy.requiresServerPurchaseVerification,isTrue);});
 test('wallet sensitive actions require password',(){expect(WalletSecurityPolicy.requiresWalletPassword('withdraw'),isTrue);expect(WalletSecurityPolicy.storePlaintextPassword,isFalse);});
 test('user xp respects daily cap',(){expect(UserLevelPolicy.cappedXp(earned:120,dailyCap:100),100);expect(UserLevelPolicy.canDecreaseLevel,isFalse);});
 test('agency removal auto accepts after 24h',(){expect(AgencyRemovalPolicy.autoAcceptAfter(const Duration(hours:23)),isFalse);expect(AgencyRemovalPolicy.autoAcceptAfter(const Duration(hours:24)),isTrue);});
}
