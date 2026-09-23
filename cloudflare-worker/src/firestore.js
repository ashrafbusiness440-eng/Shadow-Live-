import { googleAccessToken, parseServiceAccount } from "./google-auth.js";

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

  async function call(url, options = {}) {
    const accessToken = await googleAccessToken(env);
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${accessToken}`);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(url, { ...options, headers });
    if (response.status === 404) return { response, body: null };
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = body?.error?.status || body?.error?.message || `http_${response.status}`;
      const error = new Error(String(code));
      error.status = response.status;
      error.details = body;
      throw error;
    }
    return { response, body };
  }

  function documentName(path) {
    return `projects/${projectId}/databases/(default)/documents/${path}`;
  }

  return {
    projectId,
    documentName,

    async beginTransaction() {
      const { body } = await call(`${root}/documents:beginTransaction`, {
        method: "POST",
        body: JSON.stringify({ options: { readWrite: {} } }),
      });
      return body.transaction;
    },

    async rollback(transaction) {
      if (!transaction) return;
      await call(`${root}/documents:rollback`, {
        method: "POST",
        body: JSON.stringify({ transaction }),
      }).catch(() => {});
    },

    async get(path, transaction = null) {
      const url = new URL(`${documentRoot}/${path}`);
      if (transaction) url.searchParams.set("transaction", transaction);
      const { body } = await call(url.toString(), { method: "GET" });
      if (!body) return { exists: false, data: null, updateTime: null };
      return {
        exists: true,
        data: decodeFields(body.fields || {}),
        updateTime: body.updateTime || null,
      };
    },

    async commit(transaction, writes) {
      const { body } = await call(`${root}/documents:commit`, {
        method: "POST",
        body: JSON.stringify({ transaction, writes }),
      });
      return body;
    },

    writeUpdate(path, fields, fieldPaths = null) {
      const write = {
        update: {
          name: documentName(path),
          fields: encodeFields(fields),
        },
      };
      if (fieldPaths?.length) {
        write.updateMask = { fieldPaths };
      }
      return write;
    },

    writeCreate(path, fields) {
      return {
        update: {
          name: documentName(path),
          fields: encodeFields(fields),
        },
        currentDocument: { exists: false },
      };
    },
  };
}
