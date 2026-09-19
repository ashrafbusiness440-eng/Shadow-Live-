class ControlDashboardMetrics {
 const ControlDashboardMetrics({required this.users,required this.activeRooms,required this.openReports,required this.pendingWithdrawals,required this.pendingAgencySettlements});
 final int users,activeRooms,openReports,pendingWithdrawals,pendingAgencySettlements;
 factory ControlDashboardMetrics.fromCounts({required int users,required int activeRooms,required int openReports,required int pendingWithdrawals,required int pendingAgencySettlements}){
  for(final n in [users,activeRooms,openReports,pendingWithdrawals,pendingAgencySettlements]){if(n<0)throw ArgumentError('dashboard count cannot be negative');}
  return ControlDashboardMetrics(users:users,activeRooms:activeRooms,openReports:openReports,pendingWithdrawals:pendingWithdrawals,pendingAgencySettlements:pendingAgencySettlements);
 }
}
