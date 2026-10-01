import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  AgencyPackageError,
  archiveAgencyPackageTemplate,
  distributeAgencyPackageItem,
  grantAgencyPackage,
  listMyAgencyPackages,
  saveAgencyPackageTemplate,
} from "../../cloudflare-worker/src/agency-packages.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-economy-test" },
  "agency-package-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

async function seedBase(suffix) {
  const agencyId = "8123" + suffix.padStart(2, "0");
  const publicId = "32" + suffix.padStart(2, "0");
  const ownerUid = "package_owner_" + suffix;
  const staffUid = "package_staff_" + suffix;
  const recipientUid = "package_recipient_" + suffix;
  const managerUid = "package_manager_" + suffix;
  const now = new Date("2026-10-01T12:00:00.000Z");

  await Promise.all([
    adminDb.collection("app_asset_registry").doc("cosmetics.frame.gold").set({
      assetKey: "cosmetics.frame.gold",
      rawUrl: "https://assets.example/frame.webp",
      published: true,
      updatedAt: now,
    }),
    adminDb.collection("app_asset_registry").doc("cosmetics.entrance.star").set({
      assetKey: "cosmetics.entrance.star",
      rawUrl: "https://assets.example/entrance.webp",
      published: true,
      updatedAt: now,
    }),
    adminDb.collection("app_asset_registry").doc("cosmetics.room_background.night").set({
      assetKey: "cosmetics.room_background.night",
      rawUrl: "https://assets.example/room.webp",
      published: true,
      updatedAt: now,
    }),
    adminDb.collection("agencies").doc(agencyId).set({
      agencyId,
      publicId,
      name: "Package Agency " + suffix,
      ownerUid,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.collection("agency_ids").doc(publicId).set({
      agencyId,
      publicId,
      ownerUid,
      reserved: false,
      allocatedAt: now,
    }),
    adminDb.collection("users").doc(ownerUid).set({
      publicId: "61" + suffix.padStart(2, "0"),
      agencyId,
      agencyRole: "owner",
      accountStatus: "active",
    }),
    adminDb.collection("agency_user_memberships").doc(ownerUid).set({
      agencyId,
      uid: ownerUid,
      role: "owner",
      status: "active",
      joinedAt: now,
    }),
    adminDb.collection("users").doc(staffUid).set({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageAgencyPackages", "grantAgencyPackage"],
      accountStatus: "active",
    }),
    adminDb.collection("users").doc(managerUid).set({
      publicId: "62" + suffix.padStart(2, "0"),
      agencyId,
      agencyRole: "manager",
      accountStatus: "active",
    }),
    adminDb.collection("agency_user_memberships").doc(managerUid).set({
      agencyId,
      uid: managerUid,
      role: "manager",
      status: "active",
      joinedAt: now,
    }),
    adminDb.collection("users").doc(recipientUid).set({
      publicId: "77" + suffix.padStart(2, "0"),
      accountStatus: "active",
    }),
    adminDb.collection("public_ids").doc("77" + suffix.padStart(2, "0")).set({
      uid: recipientUid,
    }),
  ]);

  return {
    agencyId,
    publicId,
    ownerUid,
    staffUid,
    recipientUid,
    recipientPublicId: "77" + suffix.padStart(2, "0"),
    managerUid,
    now,
  };
}

function packageBody(templateId, idempotencyKey) {
  return {
    templateId,
    name: "باكيج أكتوبر",
    packageDurationHours: 24 * 30,
    idempotencyKey,
    lineItems: [
      {
        lineId: "frame_short",
        type: "frame",
        assetKey: "cosmetics.frame.gold",
        nameAr: "إطار ذهبي",
        entitlementDurationHours: 24,
        quantity: 2,
      },
      {
        lineId: "frame_long",
        type: "frame",
        assetKey: "cosmetics.frame.gold",
        nameAr: "إطار ذهبي",
        entitlementDurationHours: 48,
        quantity: 1,
      },
      {
        lineId: "entrance",
        type: "entrance",
        assetKey: "cosmetics.entrance.star",
        nameAr: "دخول النجمة",
        entitlementDurationHours: 72,
        quantity: 3,
      },
      {
        lineId: "room",
        type: "room_background",
        assetKey: "cosmetics.room_background.night",
        nameAr: "خلفية ليلية",
        entitlementDurationHours: 120,
        quantity: 1,
      },
    ],
  };
}

test("Agency Package Builder saves published assets and grants only to an Agency Owner", async () => {
  const seed = await seedBase("01");
  const template = await saveAgencyPackageTemplate(
    db,
    seed.staffUid,
    packageBody("october_pkg_01", "package_template_save_0001"),
    { now: seed.now },
  );

  assert.equal(template.code, "ok");
  assert.equal(template.lineItems.length, 4);
  assert.equal(template.lineItems[0].imageUrl, "https://assets.example/frame.webp");

  const grant = await grantAgencyPackage(
    db,
    seed.staffUid,
    {
      templateId: template.templateId,
      agencyId: seed.publicId,
      idempotencyKey: "package_grant_agency_0001",
    },
    { now: new Date("2026-10-01T12:05:00.000Z") },
  );
  assert.equal(grant.code, "ok");
  assert.equal(grant.agencyId, seed.agencyId);
  assert.equal(grant.ownerUid, seed.ownerUid);

  const inventory = await listMyAgencyPackages(
    db,
    seed.ownerUid,
    {},
    { nowMs: new Date("2026-10-01T12:06:00.000Z").getTime() },
  );
  assert.equal(inventory.packages.length, 1);
  assert.equal(inventory.packages[0].expired, false);
  assert.equal(inventory.packages[0].items[0].quantityRemaining, 2);
});

test("Agency Owner distribution decrements package stock and stacks on the existing entitlement", async () => {
  const seed = await seedBase("02");
  const template = await saveAgencyPackageTemplate(
    db,
    seed.staffUid,
    packageBody("october_pkg_02", "package_template_save_0002"),
    { now: seed.now },
  );
  const grant = await grantAgencyPackage(
    db,
    seed.staffUid,
    {
      templateId: template.templateId,
      agencyId: seed.publicId,
      idempotencyKey: "package_grant_agency_0002",
    },
    { now: new Date("2026-10-01T12:05:00.000Z") },
  );

  const firstNow = new Date("2026-10-01T13:00:00.000Z");
  const first = await distributeAgencyPackageItem(
    db,
    seed.ownerUid,
    {
      grantId: grant.grantId,
      lineId: "frame_short",
      targetPublicId: seed.recipientPublicId,
      idempotencyKey: "package_distribute_000201",
    },
    { now: firstNow },
  );
  assert.equal(first.quantityRemaining, 1);
  assert.equal(first.expiresAtMs, firstNow.getTime() + 24 * 3600000);

  const duplicate = await distributeAgencyPackageItem(
    db,
    seed.ownerUid,
    {
      grantId: grant.grantId,
      lineId: "frame_short",
      targetPublicId: seed.recipientPublicId,
      idempotencyKey: "package_distribute_000201",
    },
    { now: new Date("2026-10-01T13:01:00.000Z") },
  );
  assert.equal(duplicate.code, "duplicate");
  assert.equal(duplicate.quantityRemaining, 1);

  const second = await distributeAgencyPackageItem(
    db,
    seed.ownerUid,
    {
      grantId: grant.grantId,
      lineId: "frame_long",
      targetPublicId: seed.recipientPublicId,
      idempotencyKey: "package_distribute_000202",
    },
    { now: new Date("2026-10-01T14:00:00.000Z") },
  );
  assert.equal(
    second.expiresAtMs,
    firstNow.getTime() + (24 + 48) * 3600000,
  );

  const reward = await adminDb
    .collection("user_rewards")
    .doc(seed.recipientUid)
    .collection("items")
    .doc("frame__cosmetics.frame.gold")
    .get();
  assert.equal(reward.exists, true);
  assert.equal(reward.data().source, "agency_package");
  assert.equal(reward.data().sourceAgencyId, seed.agencyId);

  const grantDoc = await adminDb.collection("agency_package_grants")
    .doc(grant.grantId).get();
  const shortLine = grantDoc.data().items.find((item) => item.lineId === "frame_short");
  const longLine = grantDoc.data().items.find((item) => item.lineId === "frame_long");
  assert.equal(shortLine.quantityRemaining, 1);
  assert.equal(shortLine.quantityGranted, 1);
  assert.equal(longLine.quantityRemaining, 0);
  assert.equal(longLine.quantityGranted, 1);
});

test("Managers cannot distribute Agency Package inventory and expired stock cannot be used", async () => {
  const seed = await seedBase("03");
  const template = await saveAgencyPackageTemplate(
    db,
    seed.staffUid,
    {
      ...packageBody("october_pkg_03", "package_template_save_0003"),
      packageDurationHours: 1,
    },
    { now: seed.now },
  );
  const grant = await grantAgencyPackage(
    db,
    seed.staffUid,
    {
      templateId: template.templateId,
      agencyId: seed.publicId,
      idempotencyKey: "package_grant_agency_0003",
    },
    { now: seed.now },
  );

  await assert.rejects(
    distributeAgencyPackageItem(
      db,
      seed.managerUid,
      {
        grantId: grant.grantId,
        lineId: "entrance",
        targetPublicId: seed.recipientPublicId,
        idempotencyKey: "package_manager_denied_0003",
      },
      { now: new Date("2026-10-01T12:30:00.000Z") },
    ),
    (error) =>
      error instanceof AgencyPackageError &&
      error.code === "agency_owner_required",
  );

  await assert.rejects(
    distributeAgencyPackageItem(
      db,
      seed.ownerUid,
      {
        grantId: grant.grantId,
        lineId: "entrance",
        targetPublicId: seed.recipientPublicId,
        idempotencyKey: "package_expired_denied_0003",
      },
      { now: new Date("2026-10-01T13:01:00.000Z") },
    ),
    (error) =>
      error instanceof AgencyPackageError &&
      error.code === "package_expired",
  );
});

test("Archived templates cannot be granted and package actions remain bounded/off hot paths", async () => {
  const seed = await seedBase("04");
  const template = await saveAgencyPackageTemplate(
    db,
    seed.staffUid,
    packageBody("october_pkg_04", "package_template_save_0004"),
    { now: seed.now },
  );
  await archiveAgencyPackageTemplate(
    db,
    seed.staffUid,
    {
      templateId: template.templateId,
      idempotencyKey: "package_template_archive_0004",
    },
    { now: new Date("2026-10-01T12:10:00.000Z") },
  );

  await assert.rejects(
    grantAgencyPackage(
      db,
      seed.staffUid,
      {
        templateId: template.templateId,
        agencyId: seed.publicId,
        idempotencyKey: "package_archived_grant_0004",
      },
      { now: new Date("2026-10-01T12:11:00.000Z") },
    ),
    (error) =>
      error instanceof AgencyPackageError &&
      error.code === "package_template_not_active",
  );

  const source = readFileSync(
    new URL("../../cloudflare-worker/src/agency-packages.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("Timer.periodic"), false);
  assert.equal(source.includes(".snapshots()"), false);
  assert.equal(source.includes("financial_ledger"), false);
  assert.equal(source.includes("room-gift"), false);
  assert.equal(source.includes("rooms/"), false);
  assert.equal(source.includes("limit: TEMPLATE_LIMIT + 1"), true);
  assert.equal(source.includes("Math.min(LIST_LIMIT"), true);
});
