import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadAgencyHostCore } from "../../cloudflare-worker/src/agency-host.js";

test("12-A Agency Owner reuses Host core with five direct reads and no query/write", async () => {
  const uid = "stage12a_owner";
  const agencyId = "812001";
  const calls = { gets: [], queries: 0, writes: 0 };

  const fakeDb = {
    async get(path) {
      calls.gets.push(path);
      if (path === "users/" + uid) {
        return {
          exists: true,
          data: {
            agencyId,
            agencyRole: "owner",
            agencyTargetMonth: "2026-09",
            agencyTargetProgressCoins: 450000,
            agencySalaryPaidDiamonds: 45,
            giftHostActivityMonth: "2026-09",
            giftHostQualifiedDays: 8,
            giftHostMicSecondsMonth: 50400,
          },
        };
      }
      if (path === "agency_user_memberships/" + uid) {
        return {
          exists: true,
          data: { agencyId, uid, role: "owner", status: "active" },
        };
      }
      if (path === "agencies/" + agencyId) {
        return {
          exists: true,
          data: {
            agencyId,
            publicId: agencyId,
            name: "Owner Dashboard Agency",
            ownerUid: uid,
            status: "active",
          },
        };
      }
      if (path === "system_config/gift_economy") {
        return {
          exists: true,
          data: {
            hostBonusQualifiedDays: 9,
            hostBonusMinutesPerQualifiedDay: 120,
          },
        };
      }
      throw new Error("unexpected_get:" + path);
    },
    async runQuery() {
      calls.queries += 1;
      throw new Error("unexpected_query");
    },
    async commit() {
      calls.writes += 1;
      throw new Error("unexpected_write");
    },
  };

  const result = await loadAgencyHostCore(
    fakeDb,
    uid,
    new Date("2026-09-29T18:30:00.000Z"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.membership.role, "owner");
  assert.equal(result.target.progressCoins, 450000);
  assert.equal(result.target.paidDiamonds, 45);
  assert.equal(result.activity.qualifiedDays, 8);
  assert.deepEqual(calls.gets, [
    "users/" + uid,
    "agency_user_memberships/" + uid,
    "agencies/" + agencyId,
    "system_config/gift_economy",
    "users/" + uid,
  ]);
  assert.equal(calls.queries, 0);
  assert.equal(calls.writes, 0);
});

test("12-A Owner Dashboard is owner-only and receives the already-loaded core", () => {
  const hostPage = readFileSync(
    new URL("../../lib/features/agency/screens/host_my_agency_page.dart", import.meta.url),
    "utf8",
  );
  const ownerPage = readFileSync(
    new URL("../../lib/features/agency/screens/owner_agency_dashboard_page.dart", import.meta.url),
    "utf8",
  );

  assert.equal(hostPage.includes("data.membershipRole == 'owner'"), true);
  assert.equal(hostPage.includes("OwnerAgencyDashboardPage(initialCore: data)"), true);
  assert.equal(hostPage.includes("owner-agency-dashboard-entry"), true);

  assert.equal(ownerPage.includes("required this.initialCore"), true);
  assert.equal(ownerPage.includes("_data = widget.initialCore"), true);
  assert.equal(ownerPage.includes("owner-agency-dashboard"), true);
  assert.equal(ownerPage.includes("owner-host-performance-card"), true);
  assert.equal(ownerPage.includes("data.membershipRole == 'owner'"), true);
  assert.equal(ownerPage.includes("FirebaseFirestore"), false);
  assert.equal(ownerPage.includes("Timer.periodic"), false);
  assert.equal(ownerPage.includes(".snapshots()"), false);
  assert.equal(ownerPage.includes("StreamBuilder"), false);
});
