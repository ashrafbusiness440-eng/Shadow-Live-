// Drafts live within the existing gift_catalog document and never in gifts.
// Publication is an explicit second operation; room/chat senders cannot read drafts.
export const MAX_GIFT_DRAFTS = 30;

function checkedRevision(config, expectedRevision) {
  const current = Number(config?.revision ?? 0);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !Number.isSafeInteger(current) || current < 0) {
    throw Error("invalid_catalog_revision");
  }
  if (current !== expectedRevision) throw Error("gift_catalog_conflict");
  return current + 1;
}

export function giftDraftList(config) {
  return Array.isArray(config?.drafts) ? config.drafts : [];
}

export function saveCatalogGiftDraft(config, gift, expectedRevision) {
  const revision = checkedRevision(config, expectedRevision);
  const id = String(gift?.id ?? "");
  if (!id) throw Error("invalid_gift_id");
  const published = Array.isArray(config?.gifts) ? config.gifts : [];
  if (published.some((item) => item?.id === id)) throw Error("gift_draft_already_published");
  const previous = giftDraftList(config);
  const existingIndex = previous.findIndex((item) => item?.id === id);
  if (existingIndex === -1 && previous.length >= MAX_GIFT_DRAFTS) throw Error("gift_draft_limit");
  const drafts = previous.slice();
  if (existingIndex === -1) drafts.push(gift);
  else drafts[existingIndex] = gift;
  return { revision, drafts };
}

export function chooseGiftDraftForPublication(config, draftId, expectedRevision) {
  const revision = checkedRevision(config, expectedRevision);
  const existing = Array.isArray(config?.gifts) ? config.gifts : [];
  // Never silently replace seeded catalog or previously published gifts.
  if (existing.length === 0) throw Error("gift_catalog_not_initialized");
  const drafts = giftDraftList(config);
  const selected = drafts.find((gift) => gift?.id === draftId);
  if (!selected) throw Error("gift_draft_not_found");
  if (existing.some((gift) => gift?.id === draftId)) {
    throw Error("gift_draft_already_published");
  }
  return {
    revision, gift: selected,
    drafts: drafts.filter((item) => item?.id !== draftId),
  };
}

export function removeCatalogGiftDraft(config, draftId, expectedRevision) {
  const revision = checkedRevision(config, expectedRevision);
  const previous = giftDraftList(config);
  if (!previous.some((item) => item?.id === draftId)) throw Error("gift_draft_not_found");
  return { revision, drafts: previous.filter((item) => item?.id !== draftId) };
}
