abstract final class AgencyRemovalPolicy {
 static const responseWindow=Duration(hours:24);
 static const cooldown=Duration(hours:24);
 static bool autoAcceptAfter(Duration elapsed)=>elapsed>=responseWindow;
 static bool selfWithdrawalForfeitsCurrentHostSalary=>true;
 static bool firstRejectedRequestMayForceSecond=>true;
}
