import { firestoreClient } from "../src/firestore.js";
import { adminInboxTestHooks } from "../src/admin-inbox.js";
import {
  ADMIN_INBOX_INDEX_COLLECTION,
  adminInboxUpsertWrite,
} from "../src/admin-inbox-index.js";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

const env = { FIREBASE_SERVICE_ACCOUNT: raw };
const db = firestoreClient(env);
const actor = {
  uid: "admin_inbox_backfill",
  owner: true,
  role: "owner",
  adminEnabled: true,
  capabilities: new Set(),
};

const items = await adminInboxTestHooks.loadItems(db, actor);
const now = new Date();
const writes = items.map((item) =>
  adminInboxUpsertWrite(db, {
    type: item.type,
    title: item.title,
    body: item.body,
    targetId: item.targetId,
    route: item.route,
    createdAt: item.createdAt,
    priority: item.priority,
    meta: item.meta,
  })
);
writes.push(
  db.writeUpdate(
    `${ADMIN_INBOX_INDEX_COLLECTION}/__meta`,
    {
      schemaVersion: 1,
      ready: true,
      backfilledAt: now,
      sourceCount: items.length,
    },
    ["schemaVersion", "ready", "backfilledAt", "sourceCount"],
  ),
);

for (let index = 0; index < writes.length; index += 350) {
  await db.commit(null, writes.slice(index, index + 350));
}

const receipts = await db.list("admin_notification_reads", 1000);
const grouped = new Map();
for (const row of receipts) {
  const uid = String(row?.data?.userId || "").trim();
  const key = String(row?.data?.key || "").trim();
  if (!uid || !key) continue;
  const keys = grouped.get(uid) || [];
  keys.push(key);
  grouped.set(uid, keys);
}

const stateWrites = [];
for (const [uid, rawKeys] of grouped.entries()) {
  const keys = [...new Set(rawKeys)].slice(-250);
  const path = `admin_notification_read_state/${uid.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180)}`;
  stateWrites.push(
    db.writeUpdate(
      path,
      {
        userId: uid,
        readThroughMs: 0,
        keys,
        migratedFromLegacy: true,
        updatedAt: now,
      },
      ["userId", "readThroughMs", "keys", "migratedFromLegacy", "updatedAt"],
    ),
  );
}

for (let index = 0; index < stateWrites.length; index += 350) {
  await db.commit(null, stateWrites.slice(index, index + 350));
}

console.log(JSON.stringify({
  ok: true,
  indexedItems: items.length,
  legacyReceipts: receipts.length,
  migratedReadStates: grouped.size,
}));
