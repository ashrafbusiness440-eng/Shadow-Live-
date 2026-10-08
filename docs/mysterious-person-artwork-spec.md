# Shadow Live — Mysterious Person Artwork Specification

Status: CODE/Asset Studio wiring is verified. This file defines only the final visual artwork direction; account identity, IDs, ranks, support values, voice logic, permissions and subscription state remain dynamic.

## Approved visual language from the two reference videos

The primary identity is a premium anonymous hooded figure: royal/deep violet cloak, dark metallic faceless mask, restrained antique-gold armor/trim, warm amber eye glow, black-violet atmosphere. It must read as mysterious and premium, not as VIP, Nobles, Agency, Wealth or Attraction.

In the reference ranking screen, the mysterious user occupies the normal #1 ranking card while their identity is replaced by the anonymous mask/avatar and the name «الشخص الغامض». The gold banner/shield belongs to the existing ranking UI, not to the Mysterious Person asset system. Shadow Live must reuse that existing ranking card and swap identity only:
- room_identity = hooded masked avatar/emblem used wherever the account image is hidden.
- room_presence_skin = subtle horizontal skin for the ordinary room-presence list only.
- Wealth/Attraction/Top3 ranking card shape, crowns and rank colors remain owned by the existing ranking UI.
- dynamic user text always stays in Flutter UI.

## Family rules

### mysterious.room_identity
Use the hooded anonymous figure. Purple cloak + dark faceless mask + gold trim + amber eyes. No text. No UID/Public ID. Must remain readable when reduced to the room mic/avatar sizes.

### mysterious.identity_card
Black-violet base with purple depth and antique-gold ornamental edges. The hood/mask motif may appear faintly as atmosphere only. Reserve quiet zones for dynamic ID, rank, support and action buttons.

### mysterious.id_plate
Compact long purple plate with gold ornamental border. Center is empty/quiet because the 9-digit mysterious ID is always rendered dynamically by the app.

### mysterious.badge
Simplified mask/hood emblem only. Transparent background. No wording. Must stay legible as a very small badge.

### mysterious.entrance
Use the same identity, but as an effect: violet smoke/energy + black shadow + restrained gold sparks, revealing the anonymous hood/mask. It must never show or imply the real account identity.

### mysterious.vehicle
Keep the same black-violet/gold system signature and anonymous emblem. This remains presentation-only. Do not create a separate runtime or bake user data into it.

### mysterious.room_presence_skin
Use a lightweight horizontal black-violet glass treatment for the ordinary room-presence row, with restrained purple haze and a thin antique-gold edge. It must not override or duplicate ranking cards. Wealth/Attraction/Top3 keep their existing rank skins/crowns and only substitute room_identity + «الشخص الغامض» + mysterious ID dynamically.

### mysterious.voice_option_icons
Nine icons on one consistent visual system. Black/violet base, gold highlight, compact circular composition. Individual pictograms distinguish the sound options, but no labels/text are baked into the image.

## Hard prohibitions

- Never include real profile photo, name, UID, Public ID, VIP/Noble/Agency badges or real levels.
- Never bake the 9-digit mysterious ID, rank, support value, duration, prices or voice names into images.
- Never create a second asset pipeline. Use existing Asset Studio -> app_asset_registry -> ShadowAssetRegistry -> cache/fallback.
- Do not invent strict pixel dimensions until dimensions are formally approved; current templates intentionally keep dimensionsStatus=tbd.
