const clean = (value) => String(value ?? "").trim();

export const ASSET_STUDIO_VERSION = 1;

export const ASSET_STUDIO_CHANNELS = Object.freeze([
  "store",
  "agency_packages",
  "events",
  "vip",
  "agency",
  "admin_grants",
  "system",
]);

const COMMON_IMAGE_EXTS = Object.freeze(["webp", "png", "jpg", "jpeg", "gif"]);
const ALPHA_IMAGE_EXTS = Object.freeze(["webp", "png", "gif"]);

function template({
  id,
  type,
  labelAr,
  directories,
  extensions = COMMON_IMAGE_EXTS,
  transparency = "optional",
  motion = "static_or_animated",
  prompt,
}) {
  return Object.freeze({
    id,
    type,
    version: 1,
    labelAr,
    directories: Object.freeze([...directories]),
    extensions: Object.freeze([...extensions]),
    maxBytes: 2500000,
    width: null,
    height: null,
    dimensionsStatus: "tbd",
    transparency,
    motion,
    prompt,
    noteAr:
      "الأبعاد غير مثبتة رسميًا على Trello بعد؛ لا يتم اختراع مقاس. " +
      "عند اعتماد width/height لاحقًا يصبح التحقق صارمًا تلقائيًا.",
  });
}

export const ASSET_STUDIO_TEMPLATES = Object.freeze([
  template({
    id: "frame.base.v1",
    type: "frame",
    labelAr: "إطار الملف الشخصي",
    directories: ["assets/images/frames", "assets/images/vip", "assets/images/store"],
    extensions: ALPHA_IMAGE_EXTS,
    transparency: "required",
    prompt: "Decorative profile frame for Shadow Live. Keep the center transparent and do not bake user names, IDs, or photos into the artwork.",
  }),
  template({
    id: "profile_background.base.v1",
    type: "profile_background",
    labelAr: "خلفية الملف الشخصي",
    directories: ["assets/images/backgrounds", "assets/images/vip", "assets/images/store"],
    prompt: "Premium Shadow Live profile background. Keep text, user data, and dynamic badges out of the artwork.",
  }),
  template({
    id: "chat_bubble.base.v1",
    type: "chat_bubble",
    labelAr: "فقاعة دردشة",
    directories: ["assets/images/chat_bubbles", "assets/images/vip", "assets/images/store"],
    extensions: ALPHA_IMAGE_EXTS,
    transparency: "required",
    prompt: "Chat bubble skin for Shadow Live with transparent safe areas for dynamic message text and sender identity.",
  }),
  template({
    id: "room_background.base.v1",
    type: "room_background",
    labelAr: "خلفية / ثيم الغرفة",
    directories: ["assets/images/rooms", "assets/images/backgrounds", "assets/images/store", "assets/images/vip"],
    prompt: "Voice-room background for Shadow Live. Keep microphone seats, room title, IDs, chat feed, and controls readable.",
  }),
  template({
    id: "entrance.base.v1",
    type: "entrance",
    labelAr: "دخوليّة",
    directories: ["assets/images/entrances", "assets/images/vip", "assets/images/store"],
    extensions: ALPHA_IMAGE_EXTS,
    transparency: "required",
    prompt: "Entrance effect for Shadow Live. Use transparent background where appropriate and do not bake user names or IDs into the effect.",
  }),
  template({
    id: "audio_wave.base.v1",
    type: "audio_wave",
    labelAr: "موجة صوتية",
    directories: ["assets/images/audio_waves", "assets/images/vip", "assets/images/store"],
    extensions: ALPHA_IMAGE_EXTS,
    transparency: "required",
    prompt: "Audio-wave cosmetic for Shadow Live. Keep the center/avatar and microphone UI safe zones visually clear.",
  }),
  template({
    id: "badge.base.v1",
    type: "badge",
    labelAr: "شارة",
    directories: ["assets/images/badges", "assets/images/vip", "assets/images/levels", "assets/images/roles"],
    extensions: ALPHA_IMAGE_EXTS,
    transparency: "required",
    motion: "static",
    prompt: "Small readable Shadow Live badge with transparent background. Do not include dynamic user text or IDs.",
  }),
  template({
    id: "name_effect.base.v1",
    type: "name_effect",
    labelAr: "تأثير الاسم",
    directories: ["assets/images/name_effects", "assets/images/vip", "assets/images/store"],
    extensions: ALPHA_IMAGE_EXTS,
    transparency: "required",
    prompt: "Name-effect decoration for Shadow Live. The actual user name remains dynamic and must stay readable over the effect.",
  }),
  template({
    id: "mic_effect.base.v1",
    type: "mic_effect",
    labelAr: "تأثير المايك / المقعد",
    directories: ["assets/images/mic_effects", "assets/images/vip", "assets/images/store"],
    extensions: ALPHA_IMAGE_EXTS,
    transparency: "required",
    prompt: "Mic/seat cosmetic effect for Shadow Live with transparent center and no baked avatar, name, or room data.",
  }),
  template({
    id: "sticker_pack.base.v1",
    type: "sticker_pack",
    labelAr: "Sticker / Emoji",
    directories: ["assets/images/stickers", "assets/images/vip", "assets/images/store"],
    extensions: ALPHA_IMAGE_EXTS,
    transparency: "required",
    prompt: "Sticker or emoji artwork for Shadow Live with transparent background and no dynamic account data.",
  }),
  template({
    id: "profile_card.base.v1",
    type: "profile_card",
    labelAr: "بطاقة ID / Profile",
    directories: ["assets/images/cards", "assets/images/vip", "assets/images/store"],
    prompt: "Profile/ID card skin for Shadow Live. Leave all name, ID, avatar, badges, level and stats as dynamic UI layers.",
  }),
  template({
    id: "event_cosmetic.base.v1",
    type: "event_cosmetic",
    labelAr: "عنصر فعالية",
    directories: ["assets/images/events", "assets/images/store"],
    prompt: "Event cosmetic for Shadow Live. Keep all event text and user-specific data dynamic in the application UI.",
  }),
  template({
    id: "agency_cosmetic.base.v1",
    type: "agency_cosmetic",
    labelAr: "عنصر وكالة",
    directories: ["assets/images/agencies", "assets/images/store"],
    prompt: "Agency cosmetic for Shadow Live. Agency name, ID, owner and member data must remain dynamic UI layers.",
  }),
  template({
    id: "vip_cosmetic.base.v1",
    type: "vip_cosmetic",
    labelAr: "عنصر VIP",
    directories: ["assets/images/vip"],
    prompt: "VIP cosmetic for Shadow Live. Keep user identity, VIP number, IDs and stats dynamic unless the visual is a generic tier emblem.",
  }),
  template({
    id: "system_cosmetic.base.v1",
    type: "system_cosmetic",
    labelAr: "عنصر نظام رسمي",
    directories: ["assets/images/system", "assets/images/misc"],
    prompt: "Official Shadow Live system cosmetic. Do not bake user-specific or mutable application text into the asset.",
  }),
]);

const TEMPLATE_BY_ID = new Map(
  ASSET_STUDIO_TEMPLATES.map((item) => [item.id, item]),
);

export function assetStudioTemplateById(value) {
  return TEMPLATE_BY_ID.get(clean(value)) || null;
}

export function normalizeAssetStudioChannels(input) {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(ASSET_STUDIO_CHANNELS);
  return [...new Set(input.map(clean).filter((value) => allowed.has(value)))];
}

function extensionOf(fileName) {
  const value = clean(fileName).toLowerCase();
  const index = value.lastIndexOf(".");
  return index > 0 && index < value.length - 1 ? value.slice(index + 1) : "";
}

function normalizeDirectory(value) {
  let text = clean(value).replace(/\\/g, "/");
  while (text.endsWith("/")) text = text.slice(0, -1);
  return text;
}

function safeDirectoryWithinRoot(value, root) {
  const directory = normalizeDirectory(value);
  const normalizedRoot = normalizeDirectory(root);
  if (
    !directory ||
    !normalizedRoot ||
    directory.startsWith("/") ||
    directory.includes("//")
  ) {
    return false;
  }
  const segments = directory.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(segment),
    )
  ) {
    return false;
  }
  return directory === normalizedRoot ||
    directory.startsWith(`${normalizedRoot}/`);
}

export function validateAssetStudioMetadata({
  studioVersion,
  assetType,
  templateId,
  channels,
  directory,
  fileName,
  byteSize,
}) {
  const version = Number(studioVersion || 0);
  const hasStudioMetadata =
    version > 0 ||
    clean(assetType) ||
    clean(templateId) ||
    (Array.isArray(channels) && channels.length > 0);

  if (!hasStudioMetadata) {
    return {
      ok: true,
      legacy: true,
      studioVersion: 0,
      template: null,
      channels: [],
    };
  }

  if (version !== ASSET_STUDIO_VERSION) {
    return { ok: false, code: "invalid_studio_version" };
  }

  const template = assetStudioTemplateById(templateId);
  if (!template || clean(assetType) !== template.type) {
    return { ok: false, code: "invalid_asset_template" };
  }

  const normalizedChannels = normalizeAssetStudioChannels(channels);
  if (!normalizedChannels.length) {
    return { ok: false, code: "invalid_asset_channels" };
  }

  if (
    !template.directories.some((root) =>
      safeDirectoryWithinRoot(directory, root)
    )
  ) {
    return { ok: false, code: "template_directory_mismatch" };
  }

  if (!template.extensions.includes(extensionOf(fileName))) {
    return { ok: false, code: "template_extension_mismatch" };
  }

  const size = Number(byteSize || 0);
  if (!Number.isFinite(size) || size <= 0 || size > template.maxBytes) {
    return { ok: false, code: "template_size_mismatch" };
  }

  return {
    ok: true,
    legacy: false,
    studioVersion: ASSET_STUDIO_VERSION,
    template,
    channels: normalizedChannels,
  };
}

export function publicAssetStudioTemplates() {
  return ASSET_STUDIO_TEMPLATES.map((item) => ({
    id: item.id,
    type: item.type,
    version: item.version,
    labelAr: item.labelAr,
    directories: [...item.directories],
    extensions: [...item.extensions],
    maxBytes: item.maxBytes,
    width: item.width,
    height: item.height,
    dimensionsStatus: item.dimensionsStatus,
    transparency: item.transparency,
    motion: item.motion,
    prompt: item.prompt,
    noteAr: item.noteAr,
  }));
}
