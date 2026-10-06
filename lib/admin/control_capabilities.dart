abstract final class ControlCapabilities {
  static const viewDashboard='viewDashboard', viewSystemHealth='viewSystemHealth', viewUsers='viewUsers', manageUsers='manageUsers';
  static const viewReports='viewReports', reviewReports='reviewReports', manageDiaries='manageDiaries', deleteDiaryComment='deleteDiaryComment', muteUsers='muteUsers';
  static const suspendUsers='suspendUsers', permanentBan='permanentBan', manageRooms='manageRooms', canCreateHiddenRoom='canCreateHiddenRoom';
  static const globalRoomControl='globalRoomControl', manageAgencies='manageAgencies';
  static const reviewAgencyApplications='reviewAgencyApplications', manageAgencyMemberships='manageAgencyMemberships';
  static const manageAgencyManagers='manageAgencyManagers', viewAgencyFinance='viewAgencyFinance';
  static const manageAgencyPolicies='manageAgencyPolicies', manageAgencySettlements='manageAgencySettlements';
  static const manageAgencyPackages='manageAgencyPackages', grantAgencyPackage='grantAgencyPackage';
  static const suspendAgencies='suspendAgencies';
  static const manageUserLevels='manageUserLevels', manageWealthLevel='manageWealthLevel', manageAttractionLevel='manageAttractionLevel', manageGameLevel='manageGameLevel';
  static const manageVip='manageVip', manageVipLevels='manageVipLevels', manageSpecialIds='manageSpecialIds', manageIds='manageIds', manageStore='manageStore';
  static const manageGames='manageGames', manageEconomy='manageEconomy', adjustBalances='adjustBalances';
  static const manageWithdrawals='manageWithdrawals', manageSettlements='manageSettlements';
  static const manageCampaigns='manageCampaigns', manageRoles='manageRoles';
  static const viewAuditLog='viewAuditLog', emergencyLock='emergencyLock';
  static const ownerOnly={manageEconomy,manageRoles,emergencyLock};
}
