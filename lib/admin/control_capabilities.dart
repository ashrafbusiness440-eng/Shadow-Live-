abstract final class ControlCapabilities {
  static const viewDashboard='viewDashboard', viewUsers='viewUsers', manageUsers='manageUsers';
  static const viewReports='viewReports', reviewReports='reviewReports', muteUsers='muteUsers';
  static const suspendUsers='suspendUsers', permanentBan='permanentBan', manageRooms='manageRooms', canCreateHiddenRoom='canCreateHiddenRoom';
  static const globalRoomControl='globalRoomControl', manageAgencies='manageAgencies';
  static const manageVip='manageVip', manageSpecialIds='manageSpecialIds', manageIds='manageIds', manageStore='manageStore';
  static const manageGames='manageGames', manageEconomy='manageEconomy', adjustBalances='adjustBalances';
  static const manageWithdrawals='manageWithdrawals', manageSettlements='manageSettlements';
  static const manageCampaigns='manageCampaigns', manageRoles='manageRoles';
  static const viewAuditLog='viewAuditLog', emergencyLock='emergencyLock';
  static const ownerOnly={manageEconomy,manageRoles,emergencyLock};
}
