import { readThroughConfigCache, primeConfigCache } from "./config-cache.js";

export const CONTENT_FILTER_PATH = "system_config/content_filter";
export const CONTENT_FILTER_COORDINATOR_ID = "!shadow_content_filter_policy:internal/v1";
const CACHE_KEY = "config:content_filter";
export const CONTENT_FILTER_SURFACES = Object.freeze([
  "private_chat", "room_chat", "diary_post", "diary_comment",
]);
export const CONTENT_FILTER_ACTIONS = Object.freeze(["mask", "block", "flag"]);
export const CONTENT_FILTER_GROUPS = Object.freeze([
  "insults", "sexual", "bullying", "threats", "spam", "ads", "links", "other",
]);
const MAX_RULES = 300;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
// Text controls and Arabic vowel marks do not form a word boundary.
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200B-\u200F\u2060\uFEFF]/u;
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
    // Arabic vowel marks and kashida are invisible modifiers, not word gaps.
    if (DIACRITICS.test(char)) {
      i += size;
      continue;
    }
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
  // Only punctuation-separated letter sequences are eligible for
  // de-obfuscation. Ordinary spaces are never joined into unrelated words.
  const obfuscated = [];
  const regexp = /[\p{L}\p{N}]+(?:[._*~\-]+[\p{L}\p{N}]+)+/gu;
  for (const hit of source.matchAll(regexp)) {
    if (obfuscated.length >= 30) break;
    const normalized = normalizeFilterText(hit[0], { joinSeparators: true });
    if (normalized.length >= 4 && normalized.length <= 80) {
      obfuscated.push({
        start: hit.index, end: hit.index + hit[0].length, normalized,
      });
    }
  }
  const normalized = chars.join("");
  const repeated = [];
  // Catch deliberate 3+ character elongation in complete words only.
  // Never compress regular doubled letters (e.g. genuine Arabic/English words).
  const repeatedPattern = /(.)\\1{2,}/gu;
  const tokens = /[^ ]+/gu;
  for (const hit of normalized.matchAll(tokens)) {
    if (repeated.length >= 30) break;
    const collapsed = hit[0].replace(repeatedPattern, "$1");
    if (collapsed !== hit[0] && collapsed.length >= 3) {
      const from = hit.index;
      repeated.push({
        normalized: collapsed,
        start: offsets[from],
        end: ends[from + hit[0].length - 1],
      });
    }
  }
  return { text: normalized, offsets, ends, obfuscated, repeated, original: source };
}

function tokenMatches(text, pattern) {
  // Only complete words or consecutive words: no false positives inside names.
  const source = typeof text === "string" ? compactMatchPositions(text) : text;
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
  if (!search.includes(" ") && search.length >= 3) {
    for (const item of [
      ...(source.obfuscated || []), ...(source.repeated || []),
    ]) {
      if (item.normalized !== search) continue;
      const before = source.original.slice(0, item.start).slice(-1);
      const after = source.original.slice(item.end, item.end + 1);
      if ((!before || !LETTER_OR_NUMBER.test(before)) &&
          (!after || !LETTER_OR_NUMBER.test(after))) {
        ranges.push([item.start, item.end]);
      }
    }
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
  // Normalize the incoming text once regardless of the number of rules.
  const prepared = compactMatchPositions(original);
  const ranges = [];
  const matchedRuleIds = new Set();
  let blocked = false;
  let flagged = false;
  for (const rule of config.rules || []) {
    if (!rule.enabled || !rule.surfaces?.includes(surface)) continue;
    // Exempt only occurrences covered by an allowed phrase, not the
    // whole message: a safe phrase cannot bypass another abusive match.
    const excluded = (rule.exceptions || []).flatMap((exception) =>
      tokenMatches(prepared, exception));
    const hits = tokenMatches(prepared, rule.pattern).filter(([start, end]) =>
      !excluded.some(([a, b]) => a <= start && b >= end));
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
