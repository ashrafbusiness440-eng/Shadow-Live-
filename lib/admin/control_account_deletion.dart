abstract final class AccountDeletionPolicy {
 static const gracePeriod=Duration(days:30);
 static bool sensitiveOperationsAllowed({required bool deletionPending})=>!deletionPending;
}
