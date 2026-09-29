import { FieldPath, FieldValue } from "firebase-admin/firestore";

function assignPath(target, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function readPath(target, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (const part of parts) {
    if (
      cursor == null ||
      typeof cursor !== "object" ||
      !Object.prototype.hasOwnProperty.call(cursor, part)
    ) {
      return { exists: false, value: undefined };
    }
    cursor = cursor[part];
  }
  return { exists: true, value: cursor };
}

function transformValue(transform) {
  if (transform?.setToServerValue === "REQUEST_TIME") {
    return FieldValue.serverTimestamp();
  }
  if (transform?.increment !== undefined) {
    const raw = transform.increment;
    const value = typeof raw === "object"
      ? Number(raw.integerValue ?? raw.doubleValue ?? raw)
      : Number(raw);
    return FieldValue.increment(value);
  }
  if (transform?.appendMissingElements) {
    const values = transform.appendMissingElements.values || [];
    const decoded = values.map((item) => {
      if (item && typeof item === "object") {
        if ("stringValue" in item) return item.stringValue;
        if ("integerValue" in item) return Number(item.integerValue);
        if ("doubleValue" in item) return Number(item.doubleValue);
        if ("booleanValue" in item) return item.booleanValue;
      }
      return item;
    });
    return FieldValue.arrayUnion(...decoded);
  }
  return undefined;
}

function mergePayload(fields = {}, transforms = []) {
  const payload = {};
  for (const [path, value] of Object.entries(fields || {})) {
    assignPath(payload, path, value);
  }
  for (const transform of transforms || []) {
    const value = transformValue(transform);
    if (value !== undefined) assignPath(payload, transform.fieldPath, value);
  }
  return payload;
}

export function cloudflareFirestoreAdapter(adminDb) {
  const ref = (path) => adminDb.doc(String(path || "").replace(/^\/+|\/+$/g, ""));
  let transactionTail = Promise.resolve();

  return {
    async beginTransaction() {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      return { active: true, release };
    },

    async rollback(transaction) {
      if (!transaction?.active) return;
      transaction.active = false;
      transaction.release?.();
    },

    async get(path) {
      const snapshot = await ref(path).get();
      return {
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : null,
        updateTime: snapshot.updateTime || null,
      };
    },

    async runQuery(collectionPath, {
      filters = [],
      orderBy = [],
      limit = 100,
      startAfter = [],
    } = {}) {
      let query = adminDb.collection(collectionPath);
      for (const filter of filters) {
        const field = filter.field === "__name__"
          ? FieldPath.documentId()
          : filter.field;
        const value = filter.referencePath
          ? adminDb.doc(filter.referencePath)
          : filter.value;
        query = query.where(field, filter.op, value);
      }
      for (const order of orderBy) {
        query = query.orderBy(
          order.field === "__name__" ? FieldPath.documentId() : order.field,
          String(order.direction || "asc").toLowerCase() === "desc"
            ? "desc"
            : "asc",
        );
      }
      if (Array.isArray(startAfter) && startAfter.length) {
        query = query.startAfter(
          ...startAfter.map((item) => {
            if (item && typeof item === "object" && item.referencePath) {
              return adminDb.doc(item.referencePath);
            }
            if (
              item &&
              typeof item === "object" &&
              Object.prototype.hasOwnProperty.call(item, "value")
            ) {
              return item.value;
            }
            return item;
          }),
        );
      }
      query = query.limit(Math.max(1, Math.min(1000, Number(limit || 100))));
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        path: doc.ref.path,
        data: doc.data(),
        updateTime: doc.updateTime || null,
      }));
    },

    async commit(transaction, writes = []) {
      try {
        const batch = adminDb.batch();
        for (const write of writes) {
          if (write.kind === "delete") {
            batch.delete(ref(write.path));
            continue;
          }
          if (write.kind === "create") {
            batch.create(
              ref(write.path),
              mergePayload(write.fields, write.transforms),
            );
            continue;
          }
          const payload = mergePayload(write.fields, write.transforms);
          if (Array.isArray(write.fieldPaths)) {
            const masked = {};
            for (const fieldPath of write.fieldPaths) {
              const current = readPath(payload, fieldPath);
              assignPath(
                masked,
                fieldPath,
                current.exists ? current.value : FieldValue.delete(),
              );
            }
            batch.set(ref(write.path), masked, { merge: true });
          } else {
            batch.set(ref(write.path), payload, { merge: true });
          }
        }
        await batch.commit();
      } finally {
        if (transaction?.active) {
          transaction.active = false;
          transaction.release?.();
        }
      }
    },

    writeUpdate(path, fields, fieldPaths = null, transforms = null) {
      return {
        kind: "update",
        path,
        fields: fields || {},
        fieldPaths: Array.isArray(fieldPaths) ? fieldPaths : null,
        transforms: transforms || [],
      };
    },

    writeCreate(path, fields, transforms = null) {
      return {
        kind: "create",
        path,
        fields: fields || {},
        transforms: transforms || [],
      };
    },

    writeDelete(path) {
      return { kind: "delete", path };
    },

    increment(fieldPath, amount) {
      return { fieldPath, increment: Number(amount) };
    },

    serverTimestamp(fieldPath) {
      return { fieldPath, setToServerValue: "REQUEST_TIME" };
    },

    arrayUnion(fieldPath, values) {
      return { fieldPath, appendMissingElements: { values: values || [] } };
    },
  };
}
