abstract final class ControlCapabilities {
  static const viewDashboard='viewDashboard', viewUsers='viewUsers', manageUsers='manageUsers';
  static const viewReports='viewReports', reviewReports='reviewReports', muteUsers='muteUsers';
  static const suspendUsers='suspendUsers', permanentBan='permanentBan', manageRooms='manageRooms';
  static const globalRoomControl='globalRoomControl', manageAgencies='manageAgencies';
  static const manageVip='manageVip', manageSpecialIds='manageSpecialIds', manageStore='manageStore';
  static const manageGames='manageGames', manageEconomy='manageEconomy';
  static const manageWithdrawals='manageWithdrawals', manageSettlements='manageSettlements';
  static const manageCampaigns='manageCampaigns', manageRoles='manageRoles';
  static const viewAuditLog='viewAuditLog', emergencyLock='emergencyLock';
  static const ownerOnly={manageEconomy,manageRoles,emergencyLock};
}
