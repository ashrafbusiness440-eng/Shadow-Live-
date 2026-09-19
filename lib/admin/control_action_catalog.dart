import 'control_capabilities.dart';
class ControlActionDefinition {
 const ControlActionDefinition(this.name,this.capability,{this.sensitive=false,this.financial=false});
 final String name,capability; final bool sensitive,financial;
}
abstract final class ControlActionCatalog {
 static const actions=<String,ControlActionDefinition>{
  'viewUsers':ControlActionDefinition('viewUsers',ControlCapabilities.viewUsers),
  'manageRoom':ControlActionDefinition('manageRoom',ControlCapabilities.manageRooms),
  'reviewReport':ControlActionDefinition('reviewReport',ControlCapabilities.reviewReports),
  'grantVip':ControlActionDefinition('grantVip',ControlCapabilities.manageVip,sensitive:true),
  'manageSpecialId':ControlActionDefinition('manageSpecialId',ControlCapabilities.manageSpecialIds,sensitive:true),
  'adjustBalance':ControlActionDefinition('adjustBalance',ControlCapabilities.manageEconomy,sensitive:true,financial:true),
  'approveWithdrawal':ControlActionDefinition('approveWithdrawal',ControlCapabilities.manageWithdrawals,sensitive:true,financial:true),
  'paySettlement':ControlActionDefinition('paySettlement',ControlCapabilities.manageSettlements,sensitive:true,financial:true),
  'changeRole':ControlActionDefinition('changeRole',ControlCapabilities.manageRoles,sensitive:true),
  'emergencyLock':ControlActionDefinition('emergencyLock',ControlCapabilities.emergencyLock,sensitive:true),
 };
 static ControlActionDefinition get(String action){
  final value=actions[action]; if(value==null)throw ArgumentError('unknown control action'); return value;
 }
}
