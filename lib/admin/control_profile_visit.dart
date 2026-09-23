abstract final class ProfileVisitPolicy {
 static bool recordVisibleVisit({required int visitorVipLevel})=>visitorVipLevel<5;
 static bool showIdentity({required int visitorVipLevel})=>visitorVipLevel<5;
}
