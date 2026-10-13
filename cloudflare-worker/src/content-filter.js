import { readThroughConfigCache, primeConfigCache } from "./config-cache.js";

export const CONTENT_FILTER_PATH = "system_config/content_filter";
export const CONTENT_FILTER_COORDINATOR_ID = "__shadow_content_filter_policy_v1";
const CACHE_KEY = "config:content_filter";
export const CONTENT_FILTER_SURFACES = Object.freeze([
  "private_chat", "room_chat", "diary_post", "diary_comment",
]);
export const CONTENT_FILTER_ACTIONS = Object.freeze(["mask", "block", "flag"]);
export const CONTENT_FILTER_GROUPS = Object.freeze([
  "insults", "sexual", "bullying", "spam", "ads", "links", "other",
]);
const MAX_RULES = 300;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/u;
const MAP = Object.freeze({
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
  "ى": "ي", "ئ": "ي", "ؤ": "و", "ة": "ه",
});
const clean = (value) => String(value ?? "").trim();

export function defaultFilterConfig() {
  return {
    enabled: false,
    surfaces: Object.fromEntries(CONTENT_FILTER_SURFACES.map((key) => [key, true])),
    rules: [],
    version: 0,
  };
}

export function normalizeFilterText(text, { joinSeparators = false } = {}) {
  const chars = [];
  for (const char of String(text ?? "").normalize("NFKC").toLowerCase()) {
    if (DIACRITICS.test(char)) continue;
    const normalized = MAP[char] || char;
    if (LETTER_OR_NUMBER.test(normalized)) chars.push(normalized);
    else if (!joinSeparators && chars[chars.length - 1] !== " ") chars.push(" ");
  }
  return chars.join("").trim();
}

function compactMatchPositions(text) {
  const source = String(text ?? "");
  const chars = [];
  const offsets = [];
  const ends = [];
  for (let i = 0; i < source.length;) {
    const char = String.fromCodePoint(source.codePointAt(i));
    const size = char.length;
    const normalized = normalizeFilterText(char, { joinSeparators: true });
    if (normalized) {
      for (const letter of normalized) {
        chars.push(letter);
        offsets.push(i);
        ends.push(i + size);
      }
    } else if (chars[chars.length - 1] !== " ") {
      chars.push(" ");
      offsets.push(i);
      ends.push(i + size);
    }
    i += size;
  }
  return { text: chars.join(""), offsets, ends };
}

function tokenMatches(text, pattern) {
  // Only complete words or consecutive words: no false positives inside names.
  const source = compactMatchPositions(text);
  const search = normalizeFilterText(pattern);
  if (!search) return [];
  const ranges = [];
  let from = 0;
  while (from <= source.text.length - search.length && ranges.length < 30) {
    const i = source.text.indexOf(search, from);
    if (i < 0) break;
    const left = i === 0 || source.text[i - 1] === " ";
    const right = i + search.length === source.text.length ||
      source.text[i + search.length] === " ";
    if (left && right) ranges.push([
      source.offsets[i], source.ends[i + search.length - 1],
    ]);
    from = i + search.length;
  }
  return ranges;
}

function safeRule(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("invalid_rule");
  const id = clean(raw.id);
  const pattern = clean(raw.pattern);
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id) ||
      pattern.length < 2 || pattern.length > 80 ||
      /[\u0000-\u001F]/u.test(pattern)) throw Error("invalid_rule");
  const action = clean(raw.action || "mask");
  const group = clean(raw.group || "other");
  if (!CONTENT_FILTER_ACTIONS.includes(action) ||
      !CONTENT_FILTER_GROUPS.includes(group)) throw Error("invalid_rule");
  const surfaces = raw.surfaces;
  if (!Array.isArray(surfaces) || surfaces.length < 1 ||
      surfaces.length > CONTENT_FILTER_SURFACES.length ||
      surfaces.some((v) => !CONTENT_FILTER_SURFACES.includes(v))) throw Error("invalid_rule");
  const exceptions = Array.isArray(raw.exceptions) ? raw.exceptions : [];
  if (exceptions.length > 8 ||
      exceptions.some((v) => typeof v !== "string" || v.length > 80))
    throw Error("invalid_rule");
  const normalized = normalizeFilterText(pattern);
  if (normalized.length < 2) throw Error("invalid_rule");
  return {
    id, pattern, action, group, enabled: raw.enabled !== false,
    surfaces: [...new Set(surfaces)],
    exceptions: exceptions.map(clean).filter(Boolean),
  };
}

export function validateFilterConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.enabled !== "boolean" ||
      !value.surfaces || typeof value.surfaces !== "object" ||
      !Array.isArray(value.rules) || value.rules.length > MAX_RULES)
    throw Error("invalid_filter_config");
  const surfaces = {};
  for (const key of CONTENT_FILTER_SURFACES) {
    if (typeof value.surfaces[key] !== "boolean") throw Error("invalid_filter_config");
    surfaces[key] = value.surfaces[key];
  }
  const rules = value.rules.map(safeRule);
  const ids = new Set();
  const duplicates = new Set();
  for (const rule of rules) {
    const normal = normalizeFilterText(rule.pattern);
    const key = `${normal}|${rule.group}|${[...rule.surfaces].sort().join(",")}`;
    if (ids.has(rule.id) || duplicates.has(key)) throw Error("duplicate_filter_rule");
    ids.add(rule.id); duplicates.add(key);
  }
  return {
    enabled: value.enabled, surfaces, rules,
  };
}

export async function loadContentFilter(db, { fresh = false } = {}) {
  const read = async () => {
    const snapshot = await db.get(CONTENT_FILTER_PATH);
    if (!snapshot.exists) return defaultFilterConfig();
    try {
      const validated = validateFilterConfig(snapshot.data);
      return { ...validated, version: Number(snapshot.data.version || 0) };
    } catch {
      // A malformed live policy must not silently permit unfiltered content.
      throw Error("invalid_filter_config");
    }
  };
  return fresh ? read() : readThroughConfigCache(CACHE_KEY, read, {
    ttlMs: 30_000, staleMs: 60_000,
  });
}

export function primeContentFilter(config) {
  primeConfigCache(CACHE_KEY, config, { ttlMs: 30_000, staleMs: 60_000 });
}

export function applyContentFilter(text, config, surface) {
  const original = String(text ?? "");
  if (!config?.enabled || config.surfaces?.[surface] !== true) {
    return { text: original, blocked: false, flagged: false, matchedRuleIds: [] };
  }
  const ranges = [];
  const matchedRuleIds = new Set();
  let blocked = false;
  let flagged = false;
  for (const rule of config.rules || []) {
    if (!rule.enabled || !rule.surfaces?.includes(surface)) continue;
    if (rule.exceptions?.some((exception) =>
      tokenMatches(original, exception).length > 0)) continue;
    const hits = tokenMatches(original, rule.pattern);
    if (!hits.length) continue;
    matchedRuleIds.add(rule.id);
    if (rule.action === "block") blocked = true;
    else if (rule.action === "flag") flagged = true;
    else ranges.push(...hits);
  }
  if (blocked) return { text: original, blocked, flagged, matchedRuleIds: [...matchedRuleIds] };
  const selected = ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let last = 0;
  let masked = "";
  for (const [start, end] of selected) {
    if (start < last) continue;
    masked += original.slice(last, start) + "***";
    last = end;
  }
  masked += original.slice(last);
  return { text: masked, blocked, flagged, matchedRuleIds: [...matchedRuleIds] };
}

export async function filterContent(db, surface, text) {
  if (!CONTENT_FILTER_SURFACES.includes(surface)) throw Error("invalid_filter_surface");
  return applyContentFilter(text, await loadContentFilter(db), surface);
}

export const contentFilterInternals = Object.freeze({
  safeRule, tokenMatches, compactMatchPositions,
});
