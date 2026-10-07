import { timestampToEpochMs } from "./vip-runtime.js";

const clean = (value) => String(value ?? "").trim();
const MYSTERIOUS_ID = /^[1-9][0-9]{8}$/;

export function activeMysteriousIdentity(user = {}, nowMs = Date.now()) {
  const mysteriousId = clean(user.mysteriousId);
  if (!MYSTERIOUS_ID.test(mysteriousId)) return false;
  if (user.mysteriousEnabled !== true) return false;
  if (user.mysteriousPermanent === true) return true;
  return timestampToEpochMs(user.mysteriousExpiresAt) > nowMs;
}

export function applyMysteriousIdentityPresentation(
  presentation = {},
  user = {},
  nowMs = Date.now(),
) {
  if (!activeMysteriousIdentity(user, nowMs)) {
    return {
      ...presentation,
      mysteriousMode: false,
      mysteriousId: "",
    };
  }

  const mysteriousId = clean(user.mysteriousId);
  return {
    ...presentation,
    displayName: "الشخص الغامض",
    profileImageUrl: "",
    profileAvatarAsset: "",
    publicId: mysteriousId,
    vipLevel: 0,
    badges: [],
    wealthLevel: 0,
    attractionLevel: 0,
    gameLevel: 0,
    activeProfileFrameAssetKey: "",
    activeProfileFrameImageUrl: "",
    activeProfileFrameExpiresAtMs: 0,
    activeProfileFramePermanent: false,
    mysteriousMode: true,
    mysteriousId,
  };
}
