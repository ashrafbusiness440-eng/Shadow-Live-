// Granular privileges for the existing Gift Catalog administration.
// A catalog editor cannot credit gift bags, adjust balances, or use other
// economy endpoints. Privileges are checked on the authenticated server.
const EDIT_ACTIONS = new Set([
  "save", "saveCategories", "saveDraft", "publishDraft", "discardDraft",
  "autosaveEditor", "clearEditor",
]);

export function giftAdminAccess(user = {}, action = "") {
  const isOwner = user.role === "owner";
  const enabled = user.adminEnabled === true;
  const caps = new Set(
    Array.isArray(user.capabilities)
      ? user.capabilities.filter((value) => typeof value === "string")
      : [],
  );
  const finance = isOwner || (enabled && caps.has("manageEconomy"));
  const editor = finance || (enabled && caps.has("manageGiftCatalog"));
  const viewer = editor || (enabled && caps.has("viewGiftStats"));

  let allowed = false;
  if (action === "state") allowed = viewer;
  else if (action === "statsRecent" || action === "statsTotals" ||
           action === "statsGiftRanking") allowed = viewer;
  else if (EDIT_ACTIONS.has(action)) allowed = editor;
  else if (action === "grantBagGift") allowed = finance;
  return {
    allowed,
    // Stats-only staff must never receive drafts or unpublished catalog.
    statsOnly: allowed && action === "state" && !editor,
  };
}
