import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_config.dart';
void main(){
 test('recharge packages match approved totals',(){
  expect(ControlConfig.rechargePackages[0.99],11000);
  expect(ControlConfig.rechargePackages[1.99],23000);
  expect(ControlConfig.rechargePackages[4.99],60000);
  expect(ControlConfig.rechargePackages[9.99],125000);
  expect(ControlConfig.rechargePackages[24.99],330000);
  expect(ControlConfig.rechargePackages[49.99],700000);
  expect(ControlConfig.rechargePackages[99.99],1500000);
 });
 test('economy reference rates',(){expect(ControlConfig.coinsPerUsd,10000);expect(ControlConfig.diamondUsd,1.0);expect(ControlConfig.minimumWithdrawalDiamonds,100.0);});
}
