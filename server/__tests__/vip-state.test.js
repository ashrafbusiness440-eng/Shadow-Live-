import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_VIP_POLICY } from "../../cloudflare-worker/src/vip-policy.js";
import {
  applyAdminVipGrant,
  applyVipGrowth,
  materializeVipState,
} from "../../cloudflare-worker/src/vip-state.js";

const day = 24 * 60 * 60 * 1000;
const base = Date.UTC(2026, 9, 1, 0, 0, 0);

test("reaching VIP starts the approved validity window", () => {
  const vip1 = applyVipGrowth(
    DEFAULT_VIP_POLICY,
    { growthPoints: 0 },
    32308,
    base,
  );
  assert.equal(vip1.earnedVipLevel, 1);
  assert.equal(vip1.effectiveVipLevel, 1);
  assert.equal(vip1.earnedVipExpiresAtMs, base + 30 * day);

  const vip7 = applyVipGrowth(
    DEFAULT_VIP_POLICY,
    {
      earnedVipLevel: 6,
      earnedVipExpiresAtMs: base + 10 * day,
      growthPoints: 116346154,
      maintenancePoints: 0,
    },
    288461538 - 116346154,
    base,
  );
  assert.equal(vip7.earnedVipLevel, 7);
  assert.equal(vip7.earnedVipExpiresAtMs, base + 60 * day);
  assert.equal(vip7.maintenancePoints, 0);
});

test("maintenance success renews the same level and resets cycle points", () => {
  const state = materializeVipState(
    DEFAULT_VIP_POLICY,
    {
      earnedVipLevel: 2,
      earnedVipExpiresAtMs: base + 30 * day,
      growthPoints: 1292308,
      maintenancePoints: 1292308,
    },
    base + 30 * day + 1000,
  );
  assert.equal(state.earnedVipLevel, 2);
  assert.equal(state.maintenancePoints, 0);
  assert.equal(state.earnedVipExpiresAtMs, base + 60 * day);
});

test("failed VIP4 maintenance downgrades once with approved retained progress", () => {
  const state = materializeVipState(
    DEFAULT_VIP_POLICY,
    {
      earnedVipLevel: 4,
      earnedVipExpiresAtMs: base + 30 * day,
      growthPoints: 11630769,
      maintenancePoints: 0,
    },
    base + 30 * day + 1,
  );
  assert.equal(state.earnedVipLevel, 3);
  assert.equal(state.growthPoints, 10700307);
  assert.equal(state.earnedVipExpiresAtMs, base + 60 * day);
});

test("lazy expiry processes long absence without polling", () => {
  const state = materializeVipState(
    DEFAULT_VIP_POLICY,
    {
      earnedVipLevel: 3,
      earnedVipExpiresAtMs: base + 30 * day,
      growthPoints: 3876923,
      maintenancePoints: 0,
    },
    base + 100 * day,
  );
  assert.equal(state.earnedVipLevel, 0);
  assert.equal(state.effectiveVipLevel, 0);
  assert.equal(state.earnedVipExpiresAtMs, 0);
  assert.ok(state.expiryMaterializationSteps <= 3);
});

test("admin grant overlays earned VIP without pausing natural expiry", () => {
  const earned = {
    earnedVipLevel: 2,
    earnedVipExpiresAtMs: base + 30 * day,
    growthPoints: 1292308,
    maintenancePoints: 0,
  };
  const grant = applyAdminVipGrant(
    DEFAULT_VIP_POLICY,
    earned,
    { vipLevel: 7, expiresAtMs: base + 12 * day },
    base + 5 * day,
  );
  assert.equal(grant.effectiveVipLevel, 7);
  assert.equal(grant.effectiveVipSource, "admin_grant");
  assert.equal(grant.earnedVipExpiresAtMs, base + 30 * day);

  const afterGrant = materializeVipState(
    DEFAULT_VIP_POLICY,
    grant,
    base + 12 * day + 1,
  );
  assert.equal(afterGrant.adminGrantVipLevel, 0);
  assert.equal(afterGrant.effectiveVipLevel, 2);
  assert.equal(afterGrant.earnedVipExpiresAtMs, base + 30 * day);
  assert.equal(
    Math.floor((afterGrant.earnedVipExpiresAtMs - (base + 12 * day)) / day),
    18,
  );
});

test("growth earned during admin grant still advances natural VIP state", () => {
  const grant = applyAdminVipGrant(
    DEFAULT_VIP_POLICY,
    {
      earnedVipLevel: 1,
      earnedVipExpiresAtMs: base + 30 * day,
      growthPoints: 32308,
      maintenancePoints: 0,
    },
    { vipLevel: 7, expiresAtMs: base + 7 * day },
    base,
  );
  const progressed = applyVipGrowth(
    DEFAULT_VIP_POLICY,
    grant,
    1292308 - 32308,
    base + day,
  );
  assert.equal(progressed.earnedVipLevel, 2);
  assert.equal(progressed.effectiveVipLevel, 7);
  assert.equal(progressed.growthPoints, 1292308);
});
