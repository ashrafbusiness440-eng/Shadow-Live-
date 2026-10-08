# Shadow Live — Mysterious Person Artwork Specification

Status: CODE/Asset Studio wiring is verified. This file defines only the final visual artwork direction; account identity, IDs, ranks, support values, voice logic, permissions and subscription state remain dynamic.

## Approved visual language from the two reference videos

The primary identity is a premium anonymous hooded figure: royal/deep violet cloak, dark metallic faceless mask, restrained antique-gold armor/trim, warm amber eye glow, black-violet atmosphere. It must read as mysterious and premium, not as VIP, Nobles, Agency, Wealth or Attraction.

The ranking presentation is intentionally different from the avatar. In the reference, the mysterious user appears in the #1 ranking slot as a tall antique-gold banner/shield with a simple anonymous-mask emblem. Shadow Live should preserve that separation:
- room_identity = hooded masked avatar/emblem.
- room_presence_skin = gold ranking/presence banner treatment.
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
Use the reference ranking language: tall gold banner/shield, subtle geometric texture, crown-safe top region, centered anonymous-mask emblem. It must NOT simply reuse the purple avatar art. All name/ID/rank/support/crown text remains dynamic.

### mysterious.voice_option_icons
Nine icons on one consistent visual system. Black/violet base, gold highlight, compact circular composition. Individual pictograms distinguish the sound options, but no labels/text are baked into the image.

## Hard prohibitions

- Never include real profile photo, name, UID, Public ID, VIP/Noble/Agency badges or real levels.
- Never bake the 9-digit mysterious ID, rank, support value, duration, prices or voice names into images.
- Never create a second asset pipeline. Use existing Asset Studio -> app_asset_registry -> ShadowAssetRegistry -> cache/fallback.
- Do not invent strict pixel dimensions until dimensions are formally approved; current templates intentionally keep dimensionsStatus=tbd.
