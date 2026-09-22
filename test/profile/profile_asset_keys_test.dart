import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/core/assets/shadow_asset_registry.dart';

void main() {
  test('profile asset keys stay stable', () {
    expect(ShadowAssetKeys.verifiedBadge, 'badge.verified');
    expect(ShadowAssetKeys.supportTeamBadge, 'badge.support_team');
    expect(ShadowAssetKeys.ownerBadge, 'role.owner');
    expect(ShadowAssetKeys.vipBadge(3), 'vip.badge.3');
    expect(ShadowAssetKeys.levelBadge(12), 'level.badge.12');
  });
}
