import assert from "node:assert/strict";
import test from "node:test";
import {
  applyContentFilter, normalizeFilterText, validateFilterConfig,
  defaultFilterConfig, contentFilterInternals,
} from "../../cloudflare-worker/src/content-filter.js";

const surfaces = {
  private_chat: true, room_chat: true,
  diary_post: true, diary_comment: true,
};
const rule = (id, pattern, action = "mask", extras = {}) => ({
  id, pattern, action, group: "insults", enabled: true,
  surfaces: ["private_chat", "room_chat", "diary_post", "diary_comment"],
  exceptions: [], ...extras,
});
const policy = (rules, areas = surfaces) => ({
  enabled: true, surfaces: areas, rules,
});

test("starts OFF with no unreviewed words", () => {
  const p = defaultFilterConfig();
  assert.equal(p.enabled, false);
  assert.deepEqual(p.rules, []);
  assert.equal(applyContentFilter("أي رسالة", p, "room_chat").text, "أي رسالة");
});

test("Arabic variants and diacritics match full words, not parts of names", () => {
  const p = policy([rule("rule_aaaaaa", "اهانة")]);
  assert.equal(normalizeFilterText("إِهَــانَة"), "اهانه");
  assert.equal(applyContentFilter("إِهَــانَة", p, "private_chat").text, "***");
  assert.equal(applyContentFilter("هذه إهانة كبيرة", p, "private_chat").text,
    "هذه *** كبيرة");
  assert.equal(applyContentFilter("الإهانات ليست هنا", p, "private_chat").text,
    "الإهانات ليست هنا");
});

test("multi-word phrases mask with no extra clipping", () => {
  const p = policy([rule("rule_bbbbbb", "يا سيئ")]);
  assert.equal(applyContentFilter("مرحبا يا سيئ جدا", p, "diary_comment").text,
    "مرحبا *** جدا");
});

test("per-surface controls, exceptions and off rules", () => {
  const p = policy([rule("rule_cccccc", "عبارة", "block", {
    exceptions: ["عبارة مفيدة"],
    surfaces: ["room_chat"],
  })], { ...surfaces, room_chat: false });
  assert.equal(applyContentFilter("عبارة", p, "room_chat").blocked, false);
  p.surfaces.room_chat = true;
  assert.equal(applyContentFilter("عبارة مفيدة", p, "room_chat").blocked, false);
  assert.equal(applyContentFilter("عبارة", p, "room_chat").blocked, true);
  assert.equal(applyContentFilter("عبارة", p, "private_chat").blocked, false);
});

test("mask/block/flag are distinct and block takes priority", () => {
  const p = policy([
    rule("rule_dddddd", "غير لائق", "mask"),
    rule("rule_eeeeee", "تهديد", "block"),
    rule("rule_ffffff", "تجاوز", "flag"),
  ]);
  const result = applyContentFilter("هذا غير لائق وفيه تجاوز", p, "diary_post");
  assert.equal(result.text, "هذا *** وفيه تجاوز");
  assert.equal(result.flagged, true);
  assert.equal(result.blocked, false);
  const blocked = applyContentFilter("هذا تهديد", p, "diary_post");
  assert.equal(blocked.blocked, true);
});

test("rejects duplicates, arbitrary regex and oversized imports", () => {
  assert.throws(() => validateFilterConfig(policy([
    rule("rule_gggggg", "مسيئة"),
    rule("rule_hhhhhh", "مسيئة"),
  ])), /duplicate_filter_rule/);
  assert.throws(() => validateFilterConfig(policy([
    rule("rule_jjjjjj", "مسيئة", "replace_with_custom_regex"),
  ])), /invalid_rule/);
  assert.throws(() => validateFilterConfig(policy(
    Array.from({ length: 301 }, (_, i) =>
      rule("rule_" + String(i).padStart(6, "0"), "شتيمة" + i),
  )), /invalid_filter_config/);
  assert.equal(contentFilterInternals.tokenMatches("لطيف", "طيف").length, 0);
});
