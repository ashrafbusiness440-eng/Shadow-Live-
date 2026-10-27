import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_GIFT_DRAFTS, giftDraftList, saveCatalogGiftDraft,
  chooseGiftDraftForPublication, removeCatalogGiftDraft,
} from "../../cloudflare-worker/src/gift-draft-policy.js";

const gift = (id) => ({ id, category: "general", priceCoins: 500, nameAr: "هدية" });
test("storing a draft never changes published gifts", () => {
  const active = gift("rose");
  const config = { revision: 3, gifts: [active], drafts: [] };
  const next = saveCatalogGiftDraft(config, gift("seasonal"), 3);
  assert.equal(next.revision, 4);
  assert.deepEqual(config.gifts, [active]);
  assert.deepEqual(config.drafts, []);
  assert.deepEqual(next.drafts.map((x) => x.id), ["seasonal"]);
});
test("an uninitialized catalog cannot be converted to a drafts-only document", () => {
  assert.throws(() => saveCatalogGiftDraft(null, gift("sample"), 0), /gift_catalog_not_initialized/);
  assert.throws(() => saveCatalogGiftDraft({ drafts: [] }, gift("sample"), 0), /gift_catalog_not_initialized/);
});
test("published IDs and stale revision cannot be saved as new drafts", () => {
  const state = { revision: 2, gifts: [gift("rose")], drafts: [] };
  assert.throws(() => saveCatalogGiftDraft(state, gift("rose"), 2), /gift_draft_already_published/);
  assert.throws(() => saveCatalogGiftDraft(state, gift("other"), 1), /gift_catalog_conflict/);
});
test("repeated draft edits update only that draft, bounded at 30", () => {
  const config = { revision: 0, gifts: [gift("rose")], drafts: [gift("sample")] };
  const updated = saveCatalogGiftDraft(config, { ...gift("sample"), priceCoins: 2000 }, 0);
  assert.equal(updated.drafts.length, 1);
  assert.equal(updated.drafts[0].priceCoins, 2000);
  const full = { revision: 0, gifts: [gift("rose")], drafts: Array.from({ length: MAX_GIFT_DRAFTS }, (_, i) => gift("draft" + i)) };
  assert.throws(() => saveCatalogGiftDraft(full, gift("extra"), 0), /gift_draft_limit/);
});
test("publishing draft requires initialized catalog, no duplicate, correct revision", () => {
  assert.throws(() => chooseGiftDraftForPublication({ drafts: [gift("a")] }, "a", 0), /gift_catalog_not_initialized/);
  const config = { revision: 4, gifts: [gift("rose")], drafts: [gift("special")] };
  const chosen = chooseGiftDraftForPublication(config, "special", 4);
  assert.equal(chosen.revision, 5);
  assert.equal(chosen.gift.id, "special");
  assert.equal(chosen.drafts.length, 0);
  assert.equal(config.drafts.length, 1);
  assert.throws(() => chooseGiftDraftForPublication(config, "missing", 4), /gift_draft_not_found/);
  assert.throws(() => chooseGiftDraftForPublication(config, "special", 3), /gift_catalog_conflict/);
});
test("discarding draft cannot delete active catalog entries", () => {
  const config = { revision: 2, gifts: [gift("rose")], drafts: [gift("sample")] };
  const result = removeCatalogGiftDraft(config, "sample", 2);
  assert.equal(result.drafts.length, 0);
  assert.equal(config.gifts.length, 1);
  assert.equal(giftDraftList(config).length, 1);
});

test("drafts are isolated from public catalogue and paid sending code paths", async () => {
  const { readFileSync } = await import("node:fs");
  const root = new URL("../../cloudflare-worker/src/", import.meta.url);
  const admin = readFileSync(new URL("legacy-economy/gift-catalog.js", root), "utf8");
  const room = readFileSync(new URL("room-gift.js", root), "utf8");
  const chats = readFileSync(new URL("chat-safety-actions.js", root), "utf8");
  assert.match(admin, /Array\.isArray\(config\?\.gifts\)/);
  assert.match(room, /catalogSnap\.data\?\.gifts/);
  assert.match(chats, /catalog\.data\?\.gifts/);
  assert.match(admin, /action === "saveDraft"/);
  assert.match(admin, /action === "publishDraft"/);
  assert.match(admin, /action === "discardDraft"/);
});
