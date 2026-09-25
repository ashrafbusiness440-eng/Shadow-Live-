export const AUTH_STATE_MAX_ATTEMPTS = 3;
export const AUTH_STATE_BASE_DELAY_MS = 350;
export const AUTH_STATE_MAX_DELAY_MS = 2500;
export const AUTH_STATE_JITTER_MS = 220;

export function isTransientAuthStateStatus(status) {
  const value = Number(status || 0);
  return value === 429 || value >= 500;
}

function retryAfterMs(response, nowMs = Date.now()) {
  const raw = String(response?.headers?.get?.("retry-after") || "").trim();
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(AUTH_STATE_MAX_DELAY_MS, Math.round(seconds * 1000));
  }

  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return 0;
  return Math.min(
    AUTH_STATE_MAX_DELAY_MS,
    Math.max(0, Math.round(dateMs - nowMs)),
  );
}

export function authStateRetryDelayMs(
  response,
  attempt,
  { randomImpl = Math.random, nowMs = Date.now() } = {},
) {
  const fromHeader = retryAfterMs(response, nowMs);
  if (fromHeader > 0) return fromHeader;

  const exponential = Math.min(
    AUTH_STATE_MAX_DELAY_MS,
    AUTH_STATE_BASE_DELAY_MS * (2 ** Math.max(0, Number(attempt || 0))),
  );
  const jitter = Math.floor(
    Math.max(0, Math.min(1, Number(randomImpl()) || 0)) *
      AUTH_STATE_JITTER_MS,
  );
  return Math.min(AUTH_STATE_MAX_DELAY_MS, exponential + jitter);
}

export async function fetchAuthStateResponse(
  url,
  token,
  {
    fetchImpl = fetch,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    randomImpl = Math.random,
    maxAttempts = AUTH_STATE_MAX_ATTEMPTS,
  } = {},
) {
  let response = null;
  let lastError = null;
  const attempts = Math.max(1, Math.min(3, Number(maxAttempts || 1)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      lastError = null;
    } catch (error) {
      response = null;
      lastError = error;
    }

    const transient =
      response === null || isTransientAuthStateStatus(response.status);
    if (!transient || attempt >= attempts - 1) break;

    const delayMs = authStateRetryDelayMs(response, attempt, {
      randomImpl,
    });
    await sleepImpl(delayMs);
  }

  return {
    response,
    error: lastError,
  };
}
