abstract final class ProfileVisitPolicy {
  static bool canViewHistory({required int viewerVipLevel}) =>
      viewerVipLevel >= 1;

  static bool recordVisibleVisit({required int visitorVipLevel}) =>
      visitorVipLevel < 9;

  static bool showIdentity({required int visitorVipLevel}) =>
      visitorVipLevel < 9;
}
