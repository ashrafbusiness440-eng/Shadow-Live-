import 'control_capabilities.dart';
abstract final class ControlPermissionsMatrix {
 static const defaultModerator={ControlCapabilities.viewReports,ControlCapabilities.muteUsers};
 static const defaultAdmin={...defaultModerator,ControlCapabilities.viewDashboard,ControlCapabilities.viewUsers,ControlCapabilities.manageRooms};
 static const defaultSuperAdmin={...defaultAdmin};
 static Set<String> effective({required String role,required Iterable<String> explicit}){
  if(role=='owner'){
   return {
    ControlCapabilities.viewDashboard,ControlCapabilities.viewUsers,ControlCapabilities.manageUsers,
    ControlCapabilities.viewReports,ControlCapabilities.reviewReports,ControlCapabilities.muteUsers,
    ControlCapabilities.suspendUsers,ControlCapabilities.permanentBan,ControlCapabilities.manageRooms,
    ControlCapabilities.globalRoomControl,ControlCapabilities.manageAgencies,ControlCapabilities.manageVip,
    ControlCapabilities.manageSpecialIds,ControlCapabilities.manageStore,ControlCapabilities.manageGames,
    ControlCapabilities.manageEconomy,ControlCapabilities.manageWithdrawals,ControlCapabilities.manageSettlements,
    ControlCapabilities.manageCampaigns,ControlCapabilities.manageRoles,ControlCapabilities.viewAuditLog,
    ControlCapabilities.emergencyLock,
   };
  }
  return explicit.toSet();
 }
}
