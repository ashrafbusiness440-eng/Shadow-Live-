import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { changeAgencyStatus } from "../../cloudflare-worker/src/agency-control.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-stage13c-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => deleteApp(app));

async function seedAgency(agencyId, ownerUid) {
  const now = new Date("2026-09-29T22:00:00.000Z");
  await adminDb.collection("agencies").doc(agencyId).set({
    schemaVersion: 1,
    agencyId,
    publicId: agencyId,
    name: "Stage 13-C Agency",
    ownerUid,
    status: "active",
    memberCount: 3,
    hostCount: 2,
    managerCount: 0,
    seniorManagerCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

test("13-C suspension/resume is atomic, audited, notified, and idempotent", async () => {
  const agencyId = "813101";
  const ownerUid = "stage13c_owner_1";
  await seedAgency(agencyId, ownerUid);
  const suspendedAt = new Date("2026-09-29T22:10:00.000Z");
  const suspendBody = {
    agencyId,
    status: "suspended",
    reason: "Emergency safety review",
    idempotencyKey: "stage13c_suspend_0001",
  };
  const first = await changeAgencyStatus(db, "shadow_admin", suspendBody, {
    now: suspendedAt,
  });
  const duplicate = await changeAgencyStatus(db, "shadow_admin", suspendBody, {
    now: suspendedAt,
  });
  assert.equal(first.code, "ok");
  assert.equal(duplicate.code, "duplicate");

  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(agency.data().status, "suspended");
  assert.equal(agency.data().suspensionReason, "Emergency safety review");
  assert.equal(agency.data().memberCount, 3);
  assert.equal(agency.data().hostCount, 2);

  const eventId = agencyId + "_suspend_stage13c_suspend_0001";
  const [event, audit, notification] = await Promise.all([
    adminDb.collection("agency_status_events").doc(eventId).get(),
    adminDb.collection("admin_audit_logs").doc("agency_status_" + eventId).get(),
    adminDb.collection("notifications").doc("agency_status_" + eventId).get(),
  ]);
  assert.equal(event.data().type, "suspend");
  assert.equal(audit.data().action, "suspendAgency");
  assert.equal(notification.data().userId, ownerUid);

  await changeAgencyStatus(db, "shadow_admin", {
    agencyId,
    status: "active",
    reason: "Safety review completed",
    idempotencyKey: "stage13c_resume_0001",
  }, { now: new Date("2026-09-29T22:20:00.000Z") });
  const resumed = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(resumed.data().status, "active");
  assert.equal(resumed.data().suspensionReason, null);
});

test("13-C permanent closure preserves all agency data and cannot be reopened", async () => {
  const agencyId = "813102";
  await seedAgency(agencyId, "stage13c_owner_2");
  await changeAgencyStatus(db, "shadow_owner", {
    agencyId,
    status: "closed",
    reason: "Permanent closure approved by owner",
    idempotencyKey: "stage13c_close_0001",
  });
  const agency = await adminDb.collection("agencies").doc(agencyId).get();
  assert.equal(agency.exists, true);
  assert.equal(agency.data().status, "closed");
  assert.equal(agency.data().memberCount, 3);
  assert.equal(agency.data().closureReason, "Permanent closure approved by owner");
  await assert.rejects(changeAgencyStatus(db, "shadow_owner", {
    agencyId,
    status: "active",
    reason: "Attempted reopen",
    idempotencyKey: "stage13c_reopen_0001",
  }), /agency_closed/);
});

test("13-C requires a reason and stays bounded/scan-free", async () => {
  await assert.rejects(changeAgencyStatus(db, "shadow_owner", {
    agencyId: "813103",
    status: "suspended",
    reason: "",
    idempotencyKey: "stage13c_reason_0001",
  }), /agency_status_reason_required/);

  const source = readFileSync(
    new URL("../../cloudflare-worker/src/agency-control.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function changeAgencyStatus");
  const end = source.indexOf("export async function directCreateAgency");
  const segment = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(segment.includes(".runQuery("), false);
  assert.equal(segment.includes(".list("), false);
  assert.equal(segment.includes("delete"), false);

  const route = source.slice(source.indexOf("export async function agencyControl"));
  assert.equal(route.includes('if (action === "changeStatus")'), true);
  assert.equal(route.includes("canCloseAgencies"), true);
  assert.equal(route.includes("canSuspendAgencies"), true);
});
