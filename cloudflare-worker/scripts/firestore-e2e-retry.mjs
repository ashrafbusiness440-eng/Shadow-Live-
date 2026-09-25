const DEFAULT_PACE_MS = 250;
const DEFAULT_MAX_ATTEMPTS = 4;
const MAX_DELAY_MS = 4000;

let nextAllowedAtMs = 0;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function pace(paceMs = DEFAULT_PACE_MS) {
  const now = Date.now();
  const waitMs = Math.max(0, nextAllowedAtMs - now);
  if (waitMs > 0) await sleep(waitMs);
  nextAllowedAtMs = Date.now() + Math.max(0, Number(paceMs || 0));
}

async function transientResponse(response) {
  if (!response) return true;
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return true;
  }
  if (response.status >= 400) {
    const text = await response.clone().text().catch(() => "");
    return /RESOURCE_EXHAUSTED|UNAVAILABLE|ABORTED/i.test(text);
  }
  return false;
}

function retryDelayMs(response, attempt) {
  const raw = String(response?.headers?.get?.("retry-after") || "").trim();
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_DELAY_MS, Math.round(seconds * 1000));
    }
  }
  const base = Math.min(MAX_DELAY_MS, 500 * (2 ** Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(MAX_DELAY_MS, base + jitter);
}

export async function firestoreE2eFetch(
  url,
  options = {},
  {
    paceMs = DEFAULT_PACE_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = {},
) {
  const attempts = Math.max(1, Math.min(5, Number(maxAttempts || 1)));
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await pace(paceMs);

    try {
      lastResponse = await fetch(url, options);
      lastError = null;
    } catch (error) {
      lastResponse = null;
      lastError = error;
    }

    const transient = lastResponse
      ? await transientResponse(lastResponse)
      : true;
    if (!transient || attempt >= attempts - 1) {
      if (lastResponse) return lastResponse;
      throw lastError || new Error("firestore_e2e_network_error");
    }

    await sleep(retryDelayMs(lastResponse, attempt));
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("firestore_e2e_request_failed");
}
