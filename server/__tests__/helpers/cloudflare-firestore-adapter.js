import { FieldValue } from "firebase-admin/firestore";

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

  return {
    async beginTransaction() {
      return { active: true };
    },

    async rollback(transaction) {
      if (transaction) transaction.active = false;
    },

    async get(path) {
      const snapshot = await ref(path).get();
      return {
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : null,
        updateTime: snapshot.updateTime || null,
      };
    },

    async commit(transaction, writes = []) {
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
        batch.set(
          ref(write.path),
          mergePayload(write.fields, write.transforms),
          { merge: true },
        );
      }
      await batch.commit();
      if (transaction) transaction.active = false;
    },

    writeUpdate(path, fields, _fieldPaths = null, transforms = null) {
      return {
        kind: "update",
        path,
        fields: fields || {},
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
