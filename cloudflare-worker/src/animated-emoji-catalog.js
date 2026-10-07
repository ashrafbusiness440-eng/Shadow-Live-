const clean = (value) => String(value ?? "").trim();

const ITEMS = Object.freeze([
  {
    id: "vip_star",
    labelAr: "نجمة",
    assetKey: "emoji.vip_star.animation",
    minVipLevel: 4,
    fallbackGlyph: "🌟",
  },
  {
    id: "vip_crown",
    labelAr: "تاج",
    assetKey: "emoji.vip_crown.animation",
    minVipLevel: 4,
    fallbackGlyph: "👑",
  },
  {
    id: "vip_diamond",
    labelAr: "ألماسة",
    assetKey: "emoji.vip_diamond.animation",
    minVipLevel: 4,
    fallbackGlyph: "💎",
  },
  {
    id: "vip_shadow",
    labelAr: "شادو",
    assetKey: "emoji.vip_shadow.animation",
    minVipLevel: 4,
    fallbackGlyph: "✨",
  },
]);

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

export function animatedEmojiById(value) {
  return BY_ID.get(clean(value)) || null;
}

export function validateAnimatedEmojiForVip(value, vipLevel = 0) {
  const id = clean(value);
  if (!id) return null;
  const item = animatedEmojiById(id);
  if (!item) {
    const error = new Error("invalid_animated_emoji");
    error.code = "invalid_animated_emoji";
    throw error;
  }
  if (Math.max(0, Number(vipLevel || 0)) < item.minVipLevel) {
    const error = new Error("vip4_emoji_required");
    error.code = "vip4_emoji_required";
    throw error;
  }
  return { ...item };
}

export function animatedEmojiCatalog() {
  return ITEMS.map((item) => ({ ...item }));
}
