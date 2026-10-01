const cleanNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export function utcDayStartMs(ms) {
  const date = new Date(ms);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

export function splitUtcIntervalByDay(startMs, endMs) {
  const start = cleanNumber(startMs);
  const end = cleanNumber(endMs);
  if (start <= 0 || end <= start) return [];

  const segments = [];
  let cursor = start;
  while (cursor < end) {
    const dayStart = utcDayStartMs(cursor);
    const nextDayStart = dayStart + 24 * 60 * 60 * 1000;
    const segmentEnd = Math.min(end, nextDayStart);
    const seconds = Math.max(0, Math.floor((segmentEnd - cursor) / 1000));
    if (seconds > 0) {
      const day = new Date(dayStart).toISOString().slice(0, 10);
      segments.push({
        day,
        month: day.slice(0, 7),
        seconds,
      });
    }
    cursor = segmentEnd;
  }
  return segments;
}

export function riyadhDayStartMs(ms) {
  const shifted = cleanNumber(ms) + RIYADH_OFFSET_MS;
  const date = new Date(shifted);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ) - RIYADH_OFFSET_MS;
}

export function splitRiyadhIntervalByDay(startMs, endMs) {
  const start = cleanNumber(startMs);
  const end = cleanNumber(endMs);
  if (start <= 0 || end <= start) return [];

  const segments = [];
  let cursor = start;
  while (cursor < end) {
    const dayStart = riyadhDayStartMs(cursor);
    const nextDayStart = dayStart + 24 * 60 * 60 * 1000;
    const segmentEnd = Math.min(end, nextDayStart);
    const seconds = Math.max(0, Math.floor((segmentEnd - cursor) / 1000));
    if (seconds > 0) {
      const localDay = new Date(dayStart + RIYADH_OFFSET_MS)
        .toISOString()
        .slice(0, 10);
      segments.push({
        day: localDay,
        month: localDay.slice(0, 7),
        seconds,
      });
    }
    cursor = segmentEnd;
  }
  return segments;
}

export function activeMicSegments(seat, endedAtMs = Date.now()) {
  if (!seat || seat.muted !== false) return [];
  const startedAtMs = cleanNumber(seat.micStartedAtMs);
  if (startedAtMs <= 0) return [];
  return splitRiyadhIntervalByDay(startedAtMs, endedAtMs);
}

export function totalMicSeconds(segments) {
  return (Array.isArray(segments) ? segments : []).reduce(
    (sum, segment) => sum + Math.max(0, cleanNumber(segment?.seconds)),
    0,
  );
}
