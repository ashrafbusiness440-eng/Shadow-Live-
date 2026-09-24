import { firestoreClient } from "./firestore.js";
import { verifyFirebaseIdTokenValue } from "./firebase-auth.js";

let currentEnv = {};
let initialized = false;

export const legacyEnv = new Proxy({}, {
  get(_target, key) {
    return currentEnv?.[key];
  },
});

export function configureLegacyEnv(env) {
  currentEnv = env || {};
}

export function getApps() {
  return initialized ? [{}] : [];
}

export function cert(value) {
  return value;
}

export function initializeApp() {
  initialized = true;
  return {};
}

export function getAuth() {
  return {
    async verifyIdToken(token) {
      const decoded = await verifyFirebaseIdTokenValue(token, currentEnv);
      return {
        ...decoded,
        uid: decoded.sub,
      };
    },
  };
}

class LegacyTimestamp {
  constructor(ms) {
    this._ms = Number(ms || 0);
  }
  toMillis() {
    return this._ms;
  }
  toDate() {
    return new Date(this._ms);
  }
  static fromMillis(ms) {
    return new LegacyTimestamp(ms);
  }
}

function looksLikeTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value);
}

function wrapValue(value) {
  if (looksLikeTimestamp(value)) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new LegacyTimestamp(ms);
  }
  if (Array.isArray(value)) return value.map(wrapValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, wrapValue(item)]),
    );
  }
  return value;
}

const sentinel = (kind, payload = null) => ({
  __shadowFieldValue: true,
  kind,
  payload,
});

export const FieldValue = {
  serverTimestamp() {
    return sentinel("serverTimestamp");
  },
  increment(amount) {
    return sentinel("increment", Number(amount));
  },
  arrayUnion(...values) {
    return sentinel("arrayUnion", values);
  },
  delete() {
    return sentinel("delete");
  },
};

export const Timestamp = LegacyTimestamp;

function isSentinel(value) {
  return Boolean(value?.__shadowFieldValue);
}

function compileData(client, data = {}) {
  const fields = {};
  const normalPaths = [];
  const deletePaths = [];
  const transforms = [];

  for (const [fieldPath, value] of Object.entries(data || {})) {
    if (!isSentinel(value)) {
      fields[fieldPath] = value;
      normalPaths.push(fieldPath);
      continue;
    }

    if (value.kind === "delete") {
      deletePaths.push(fieldPath);
      continue;
    }
    if (value.kind === "serverTimestamp") {
      transforms.push(client.serverTimestamp(fieldPath));
      continue;
    }
    if (value.kind === "increment") {
      transforms.push(client.increment(fieldPath, value.payload));
      continue;
    }
    if (value.kind === "arrayUnion") {
      transforms.push(client.arrayUnion(fieldPath, value.payload || []));
    }
  }

  return {
    fields,
    normalPaths,
    deletePaths,
    transforms,
  };
}

class LegacyDocumentSnapshot {
  constructor(ref, raw) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = Boolean(raw?.exists);
    this._data = raw?.data ? wrapValue(raw.data) : undefined;
    this.updateTime = raw?.updateTime || null;
  }
  data() {
    return this._data;
  }
}

class LegacyQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(callback) {
    this.docs.forEach(callback);
  }
}

class LegacyDocumentReference {
  constructor(store, path) {
    this._store = store;
    this.path = String(path || "").replace(/^\/+|\/+$/g, "");
    const parts = this.path.split("/");
    this.id = parts[parts.length - 1] || "";
  }

  collection(name) {
    return new LegacyCollectionReference(
      this._store,
      `${this.path}/${String(name || "").trim()}`,
    );
  }

  async get() {
    return this._store._getDocument(this);
  }

  async set(data, options = {}) {
    await this._store._commitOne(
      this._store._writeSet(this, data, options),
    );
    return { writeTime: null };
  }

  async update(data) {
    await this._store._commitOne(
      this._store._writeUpdate(this, data),
    );
    return { writeTime: null };
  }

  async delete() {
    await this._store._commitOne(this._store.client.writeDelete(this.path));
    return { writeTime: null };
  }
}

class LegacyQuery {
  constructor(store, path, state = {}) {
    this._store = store;
    this.path = path;
    this._filters = state.filters || [];
    this._orderBy = state.orderBy || [];
    this._limit = state.limit || 100;
  }

  where(field, op, value) {
    return new LegacyQuery(this._store, this.path, {
      filters: [...this._filters, { field, op, value }],
      orderBy: this._orderBy,
      limit: this._limit,
    });
  }

  orderBy(field, direction = "asc") {
    return new LegacyQuery(this._store, this.path, {
      filters: this._filters,
      orderBy: [...this._orderBy, { field, direction }],
      limit: this._limit,
    });
  }

  limit(value) {
    return new LegacyQuery(this._store, this.path, {
      filters: this._filters,
      orderBy: this._orderBy,
      limit: Math.max(1, Math.min(1000, Number(value || 100))),
    });
  }

  async get() {
    const rows = await this._store.client.runQuery(this.path, {
      filters: this._filters,
      orderBy: this._orderBy,
      limit: this._limit,
    });
    return new LegacyQuerySnapshot(
      rows.map((row) => {
        const ref = new LegacyDocumentReference(this._store, row.path);
        return new LegacyDocumentSnapshot(ref, {
          exists: true,
          data: row.data,
          updateTime: row.updateTime,
        });
      }),
    );
  }
}

class LegacyCollectionReference extends LegacyQuery {
  constructor(store, path, state = {}) {
    super(store, String(path || "").replace(/^\/+|\/+$/g, ""), state);
    const parts = this.path.split("/");
    this.id = parts[parts.length - 1] || "";
  }

  doc(id = null) {
    const chosen = String(id || "").trim() ||
      `doc_${crypto.randomUUID().replace(/-/g, "")}`;
    return new LegacyDocumentReference(this._store, `${this.path}/${chosen}`);
  }

  async add(data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

class LegacyTransaction {
  constructor(store, transaction) {
    this._store = store;
    this._transaction = transaction;
    this._writes = [];
  }

  async get(ref) {
    if (ref instanceof LegacyDocumentReference) {
      return this._store._getDocument(ref, this._transaction);
    }
    throw new Error("legacy_transaction_query_get_not_supported");
  }

  set(ref, data, options = {}) {
    this._writes.push(this._store._writeSet(ref, data, options));
    return this;
  }

  update(ref, data) {
    this._writes.push(this._store._writeUpdate(ref, data));
    return this;
  }

  create(ref, data) {
    this._writes.push(this._store._writeCreate(ref, data));
    return this;
  }

  delete(ref) {
    this._writes.push(this._store.client.writeDelete(ref.path));
    return this;
  }
}

class LegacyWriteBatch {
  constructor(store) {
    this._store = store;
    this._writes = [];
  }
  set(ref, data, options = {}) {
    this._writes.push(this._store._writeSet(ref, data, options));
    return this;
  }
  update(ref, data) {
    this._writes.push(this._store._writeUpdate(ref, data));
    return this;
  }
  create(ref, data) {
    this._writes.push(this._store._writeCreate(ref, data));
    return this;
  }
  delete(ref) {
    this._writes.push(this._store.client.writeDelete(ref.path));
    return this;
  }
  async commit() {
    if (!this._writes.length) return [];
    const result = await this._store.client.commit(null, this._writes);
    return result?.writeResults || [];
  }
}

class LegacyFirestore {
  constructor(env) {
    this.client = firestoreClient(env);
  }

  collection(name) {
    return new LegacyCollectionReference(this, name);
  }

  batch() {
    return new LegacyWriteBatch(this);
  }

  async _getDocument(ref, transaction = null) {
    const raw = await this.client.get(ref.path, transaction);
    return new LegacyDocumentSnapshot(ref, raw);
  }

  _writeUpdate(ref, data) {
    const compiled = compileData(this.client, data);
    const mask = [...compiled.normalPaths, ...compiled.deletePaths];
    return this.client.writeUpdate(
      ref.path,
      compiled.fields,
      mask,
      compiled.transforms,
    );
  }

  _writeSet(ref, data, options = {}) {
    const compiled = compileData(this.client, data);
    const merge = options?.merge === true;
    const mask = merge
      ? [...compiled.normalPaths, ...compiled.deletePaths]
      : null;
    return this.client.writeUpdate(
      ref.path,
      compiled.fields,
      mask,
      compiled.transforms,
    );
  }

  _writeCreate(ref, data) {
    const compiled = compileData(this.client, data);
    return this.client.writeCreate(
      ref.path,
      compiled.fields,
      compiled.transforms,
    );
  }

  async _commitOne(write) {
    return this.client.commit(null, [write]);
  }

  async runTransaction(callback) {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      const transaction = await this.client.beginTransaction();
      const tx = new LegacyTransaction(this, transaction);
      try {
        const result = await callback(tx);
        if (tx._writes.length) {
          await this.client.commit(transaction, tx._writes);
        } else {
          await this.client.rollback(transaction);
        }
        return result;
      } catch (error) {
        lastError = error;
        await this.client.rollback(transaction);
        if (
          attempt < 4 &&
          (error?.message === "ABORTED" || error?.status === 409)
        ) {
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error("transaction_failed");
  }
}

export function getFirestore() {
  return new LegacyFirestore(currentEnv);
}
