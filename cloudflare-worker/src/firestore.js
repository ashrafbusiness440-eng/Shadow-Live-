import { googleAccessToken, parseServiceAccount } from "./google-auth.js";
import { recordFirestoreTelemetry } from "./pressure-telemetry.js";

export const FIRESTORE_TRANSIENT_MAX_ATTEMPTS = 3;
export const FIRESTORE_RETRY_BASE_DELAY_MS = 350;
export const FIRESTORE_RETRY_MAX_DELAY_MS = 2500;
export const FIRESTORE_RETRY_JITTER_MS = 250;
export const FIRESTORE_QUOTA_MAX_ATTEMPTS = 2;
export const FIRESTORE_QUOTA_MIN_RETRY_DELAY_MS = 1000;
export const FIRESTORE_QUOTA_BREAKER_THRESHOLD = 2;
export const FIRESTORE_QUOTA_BREAKER_MS = 10_000;

const firestoreQuotaCircuit = createFirestoreQuotaCircuitState();

function normalizedFirestoreCode(...values) {
  return values
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(" ")
    .toUpperCase()
    .replaceAll("-", "_");
}

export function isFirestoreQuotaStatus(status, body = {}) {
  const value = Number(status || 0);
  const code = normalizedFirestoreCode(
    body?.error?.status,
    body?.error?.message,
  );
  return value === 429 || code.includes("RESOURCE_EXHAUSTED");
}

export function createFirestoreQuotaCircuitState() {
  return { failures: 0, openUntilMs: 0 };
}

export function registerFirestoreQuotaFailure(state, nowMs = Date.now()) {
  const failures = Math.max(0, Number(state?.failures || 0)) + 1;
  state.failures = failures;
  if (failures >= FIRESTORE_QUOTA_BREAKER_THRESHOLD) {
    state.openUntilMs = Number(nowMs) + FIRESTORE_QUOTA_BREAKER_MS;
  }
  return state;
}

export function resetFirestoreQuotaCircuit(state) {
  state.failures = 0;
  state.openUntilMs = 0;
  return state;
}

export function isFirestoreQuotaCircuitOpen(state, nowMs = Date.now()) {
  return Number(state?.openUntilMs || 0) > Number(nowMs);
}

function firestoreQuotaUnavailableError(nowMs = Date.now(), details = null) {
  const remainingMs = Math.max(
    1000,
    Number(firestoreQuotaCircuit.openUntilMs || 0) - Number(nowMs),
  );
  const error = new Error("firestore_quota_exhausted");
  error.code = "firestore_quota_exhausted";
  error.status = 503;
  error.upstreamStatus = 429;
  error.retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  error.details = details;
  return error;
}

export function isTransientFirestoreStatus(status, body = {}) {
  const value = Number(status || 0);
  const code = normalizedFirestoreCode(
    body?.error?.status,
    body?.error?.message,
  );
  return value === 408 ||
    isFirestoreQuotaStatus(value, body) ||
    value >= 500 ||
    code.includes("UNAVAILABLE") ||
    code.includes("ABORTED");
}

export function isTransientFirestoreError(error) {
  const code = normalizedFirestoreCode(error?.code, error?.message);
  const status = Number(error?.status || 0);
  return status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500 ||
    code.includes("RESOURCE_EXHAUSTED") ||
    code.includes("FIRESTORE_QUOTA_EXHAUSTED") ||
    code.includes("UNAVAILABLE") ||
    code.includes("ABORTED") ||
    code.includes("FIRESTORE_NETWORK_ERROR");
}

export function firestoreRetryDelayMs(
  response,
  attempt,
  { randomImpl = Math.random, nowMs = Date.now() } = {},
) {
  const raw = String(response?.headers?.get?.("retry-after") || "").trim();
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(
        FIRESTORE_RETRY_MAX_DELAY_MS,
        Math.round(seconds * 1000),
      );
    }
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) {
      return Math.min(
        FIRESTORE_RETRY_MAX_DELAY_MS,
        Math.max(0, Math.round(dateMs - nowMs)),
      );
    }
  }

  const exponential = Math.min(
    FIRESTORE_RETRY_MAX_DELAY_MS,
    FIRESTORE_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, Number(attempt || 0))),
  );
  const jitter = Math.floor(
    Math.max(0, Math.min(1, Number(randomImpl()) || 0)) *
      FIRESTORE_RETRY_JITTER_MS,
  );
  return Math.min(FIRESTORE_RETRY_MAX_DELAY_MS, exponential + jitter);
}

export function firestoreErrorRetryDelayMs(
  attempt,
  { randomImpl = Math.random } = {},
) {
  return firestoreRetryDelayMs(null, attempt, { randomImpl });
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, encodeValue(item)]),
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(decodeValue);
  }
  if ("mapValue" in value) {
    return decodeFields(value.mapValue.fields || {});
  }
  return null;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

function encodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]),
  );
}

export function firestoreClient(env) {
  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const root = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
  const documentRoot = `${root}/documents`;

  async function call(
    url,
    options = {},
    {
      retryTransient = false,
      operation = "unknown",
      readMode = "none",
      writeCount = 0,
    } = {},
  ) {
    const startedAtMs = Date.now();
    let attempts = 0;
    let sawQuota = false;

    const estimateReads = (body, status = 0) => {
      if (readMode === "single") return 1;
      if (readMode === "list") {
        return Math.max(1, Array.isArray(body?.documents) ? body.documents.length : 0);
      }
      if (readMode === "query") {
        const rows = Array.isArray(body) ? body : [];
        return Math.max(
          1,
          rows.reduce((count, row) => count + (row?.document ? 1 : 0), 0),
        );
      }
      return 0;
    };

    const observe = ({
      status = 0,
      body = null,
      error = false,
      quota = false,
      circuitOpen = false,
    } = {}) => {
      recordFirestoreTelemetry(env, {
        operation,
        status,
        durationMs: Date.now() - startedAtMs,
        reads: estimateReads(body, status),
        writes: Math.max(0, Number(writeCount || 0)),
        attempts: Math.max(1, attempts),
        quota: quota || sawQuota,
        circuitOpen,
        error,
      });
    };

    if (
      retryTransient &&
      isFirestoreQuotaCircuitOpen(firestoreQuotaCircuit)
    ) {
      observe({
        status: 503,
        error: true,
        quota: true,
        circuitOpen: true,
      });
      throw firestoreQuotaUnavailableError();
    }

    const accessToken = await googleAccessToken(env);
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${accessToken}`);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    // Step 9 pressure guard: keep retries small, but space transient retries
    // enough to avoid immediate RESOURCE_EXHAUSTED amplification.
    const maxAttempts = retryTransient ? FIRESTORE_TRANSIENT_MAX_ATTEMPTS : 1;
    let response = null;
    let body = {};
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attempts = attempt + 1;
      try {
        response = await fetch(url, { ...options, headers });
        lastError = null;
      } catch (error) {
        response = null;
        body = {};
        lastError = error;
      }

      if (response?.status === 404) {
        if (retryTransient) resetFirestoreQuotaCircuit(firestoreQuotaCircuit);
        observe({ status: 404, body: null });
        return { response, body: null };
      }
      if (response) {
        body = await response.json().catch(() => ({}));
        if (response.ok) {
          if (retryTransient) resetFirestoreQuotaCircuit(firestoreQuotaCircuit);
          observe({ status: response.status, body });
          return { response, body };
        }
      }

      const quotaLimited = response
        ? isFirestoreQuotaStatus(response.status, body)
        : false;
      if (retryTransient && quotaLimited) {
        sawQuota = true;
        registerFirestoreQuotaFailure(firestoreQuotaCircuit);
      }

      const transient = response
        ? isTransientFirestoreStatus(response.status, body)
        : true;
      const attemptLimit = quotaLimited
        ? Math.min(maxAttempts, FIRESTORE_QUOTA_MAX_ATTEMPTS)
        : maxAttempts;
      const breakerOpen =
        retryTransient &&
        isFirestoreQuotaCircuitOpen(firestoreQuotaCircuit);
      const canRetry =
        retryTransient &&
        transient &&
        !breakerOpen &&
        attempt < attemptLimit - 1;
      if (!canRetry) {
        if (response) {
          if (retryTransient && quotaLimited) {
            observe({
              status: response.status,
              body,
              error: true,
              quota: true,
              circuitOpen: isFirestoreQuotaCircuitOpen(firestoreQuotaCircuit),
            });
            throw firestoreQuotaUnavailableError(Date.now(), body);
          }
          const code =
            body?.error?.status ||
            body?.error?.message ||
            `http_${response.status}`;
          const error = new Error(String(code));
          error.status = response.status;
          error.details = body;
          observe({
            status: response.status,
            body,
            error: true,
            quota: quotaLimited,
          });
          throw error;
        }
        const error = new Error("firestore_network_error");
        error.cause = lastError || null;
        observe({ status: 0, error: true });
        throw error;
      }

      const normalDelayMs = firestoreRetryDelayMs(response, attempt);
      const delayMs = quotaLimited
        ? Math.max(FIRESTORE_QUOTA_MIN_RETRY_DELAY_MS, normalDelayMs)
        : normalDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    observe({ status: 0, error: true });
    throw new Error("firestore_request_failed");
  }

  function documentName(path) {
    return `projects/${projectId}/databases/(default)/documents/${path}`;
  }

  return {
    projectId,
    documentName,

    async beginTransaction() {
      const { body } = await call(
        `${root}/documents:beginTransaction`,
        {
          method: "POST",
          body: JSON.stringify({ options: { readWrite: {} } }),
        },
        { retryTransient: true, operation: "begin_transaction" },
      );
      return body.transaction;
    },

    async rollback(transaction) {
      if (!transaction) return;
      await call(
        `${root}/documents:rollback`,
        {
          method: "POST",
          body: JSON.stringify({ transaction }),
        },
        { retryTransient: true, operation: "rollback" },
      ).catch(() => {});
    },

    async get(path, transaction = null) {
      const url = new URL(`${documentRoot}/${path}`);
      if (transaction) url.searchParams.set("transaction", transaction);
      const { body } = await call(
        url.toString(),
        { method: "GET" },
        {
          retryTransient: true,
          operation: "get",
          readMode: "single",
        },
      );
      if (!body) return { exists: false, data: null, updateTime: null };
      return {
        exists: true,
        data: decodeFields(body.fields || {}),
        updateTime: body.updateTime || null,
      };
    },

    async commit(transaction, writes) {
      const payload = { writes };
      if (transaction) payload.transaction = transaction;
      const { body } = await call(
        `${root}/documents:commit`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        {
          operation: "commit",
          writeCount: Array.isArray(writes) ? writes.length : 0,
        },
      );
      return body;
    },
    async list(collectionPath, pageSize = 200) {
      const url = new URL(`${documentRoot}/${collectionPath}`);
      url.searchParams.set("pageSize", String(Math.max(1, Math.min(1000, pageSize))));
      const { body } = await call(
        url.toString(),
        { method: "GET" },
        {
          retryTransient: true,
          operation: "list",
          readMode: "list",
        },
      );
      return (body?.documents || []).map((doc) => ({
        id: String(doc.name || "").split("/").pop(),
        path: String(doc.name || "").split("/documents/")[1] || "",
        data: decodeFields(doc.fields || {}),
        updateTime: doc.updateTime || null,
      }));
    },

    async runQuery(collectionPath, {
      filters = [],
      orderBy = [],
      limit = 100,
      transaction = null,
    } = {}) {
      const parts = String(collectionPath || "").split("/").filter(Boolean);
      if (!parts.length || parts.length % 2 === 0) {
        throw new Error("invalid_collection_path");
      }
      const collectionId = parts.pop();
      const parentPath = parts.join("/");
      const endpoint = parentPath
        ? `${documentRoot}/${parentPath}:runQuery`
        : `${root}/documents:runQuery`;

      const fieldFilters = filters.map(({ field, op, value }) => ({
        fieldFilter: {
          field: { fieldPath: field },
          op: ({
            "==": "EQUAL",
            "!=": "NOT_EQUAL",
            "<": "LESS_THAN",
            "<=": "LESS_THAN_OR_EQUAL",
            ">": "GREATER_THAN",
            ">=": "GREATER_THAN_OR_EQUAL",
            "array-contains": "ARRAY_CONTAINS",
          })[op] || "EQUAL",
          value: encodeValue(value),
        },
      }));

      let where;
      if (fieldFilters.length === 1) where = fieldFilters[0];
      else if (fieldFilters.length > 1) {
        where = { compositeFilter: { op: "AND", filters: fieldFilters } };
      }

      const structuredQuery = {
        from: [{ collectionId }],
        ...(where ? { where } : {}),
        ...(orderBy.length ? {
          orderBy: orderBy.map(({ field, direction }) => ({
            field: { fieldPath: field },
            direction: String(direction).toLowerCase() === "desc"
              ? "DESCENDING"
              : "ASCENDING",
          })),
        } : {}),
        limit: Math.max(1, Math.min(1000, Number(limit || 100))),
      };

      const { body } = await call(
        endpoint,
        {
          method: "POST",
          body: JSON.stringify({
            structuredQuery,
            ...(transaction ? { transaction } : {}),
          }),
        },
        {
          retryTransient: true,
          operation: "run_query",
          readMode: "query",
        },
      );

      return (Array.isArray(body) ? body : [])
        .map((row) => row.document)
        .filter(Boolean)
        .map((doc) => ({
          id: String(doc.name || "").split("/").pop(),
          path: String(doc.name || "").split("/documents/")[1] || "",
          data: decodeFields(doc.fields || {}),
          updateTime: doc.updateTime || null,
        }));
    },


    writeUpdate(path, fields, fieldPaths = null, updateTransforms = null) {
      const write = {
        update: {
          name: documentName(path),
          fields: encodeFields(fields),
        },
      };
      if (Array.isArray(fieldPaths)) {
        write.updateMask = { fieldPaths };
      }
      if (updateTransforms?.length) {
        write.updateTransforms = updateTransforms;
      }
      return write;
    },

    increment(fieldPath, amount) {
      return {
        fieldPath,
        increment: encodeValue(Number(amount)),
      };
    },

    serverTimestamp(fieldPath) {
      return {
        fieldPath,
        setToServerValue: "REQUEST_TIME",
      };
    },

    arrayUnion(fieldPath, values) {
      return {
        fieldPath,
        appendMissingElements: {
          values: values.map(encodeValue),
        },
      };
    },

    writeCreate(path, fields, updateTransforms = null) {
      const write = {
        update: {
          name: documentName(path),
          fields: encodeFields(fields),
        },
        currentDocument: { exists: false },
      };
      if (updateTransforms?.length) {
        write.updateTransforms = updateTransforms;
      }
      return write;
    },

    writeDelete(path) {
      return { delete: documentName(path) };
    },
  };
}
