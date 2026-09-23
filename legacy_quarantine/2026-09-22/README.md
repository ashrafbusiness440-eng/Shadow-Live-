# Legacy quarantine — 2026-09-22

This directory contains files isolated from the active Shadow Live application after the production tab-rendering recovery.

Nothing in this quarantine was intentionally deleted. Original blob contents were preserved byte-for-byte and moved here so they can be searched or restored later.

Stable production backup branch:
- backup/production-stable-2026-09-22
- production commit: 657901b5f2f29aab31642afc26d8a3dcde7b7850

Isolated groups:
- .shadow_backups/
- lib_backup_before_auth_ui/
- voice_chat_room/
- Shadow-Live-current.zip
- Shadow-Live-source.zip
- Apple iPhone 16 Pro Max mockups

Do not import runtime code from this directory. If a legacy asset or implementation is needed later, restore only the specific required file into the active project.


Second-pass Dart quarantine:
- 26 statically unreachable Dart files moved from lib/.
- Reachability roots: lib/main.dart and lib/main_control.dart.
- lib/admin/** was intentionally NOT quarantined even where currently unreachable, because it belongs to Shadow Control and may be wired later.
- Active lib/core/assets/shadow_asset_registry.dart was retained because it is reachable.
