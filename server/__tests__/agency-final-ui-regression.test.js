import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

function source(relative) {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}

test("Agencies final UI keeps account images and pending request layout stable", () => {
  const ownerPage = source(
    "lib/features/agency/screens/owner_agency_dashboard_page.dart",
  );
  const membershipSource = source(
    "cloudflare-worker/src/agency-membership.js",
  );
  const hostSource = source("cloudflare-worker/src/agency-host.js");

  assert.equal(
    membershipSource.includes(
      "profileImageUrl || user.photoUrl || user.avatarUrl",
    ),
    true,
  );
  assert.equal(
    hostSource.includes(
      "user.profileImageUrl || user.photoUrl || user.avatarUrl",
    ),
    true,
  );
  assert.equal(
    ownerPage.includes("owner-agency-pending-${request.requestId}"),
    true,
  );
  assert.equal(ownerPage.includes("maxLines: 1"), true);
  assert.equal(ownerPage.includes("owner-pending-copy-id-"), true);
  assert.equal(ownerPage.includes("إلغاء الدعوة"), true);
  assert.equal(ownerPage.includes("فتح الملف الشخصي"), false);
});

test("Agencies target table renders every configured level and display-only economics", () => {
  const hostPage = source(
    "lib/features/agency/screens/host_my_agency_page.dart",
  );
  const hostSource = source("cloudflare-worker/src/agency-host.js");

  assert.equal(hostPage.includes("...levels.map((level)"), true);
  assert.equal(hostPage.includes("Gross Support ≈"), true);
  assert.equal(hostPage.includes("Host Share:"), true);
  assert.equal(hostPage.includes("Activity Bonus:"), true);
  assert.equal(hostPage.includes("شرط النشاط:"), true);
  assert.equal(hostPage.includes("تقدم المستوى التالي:"), true);
  assert.equal(hostSource.includes("targetPolicy.map"), false);
  assert.equal(hostSource.includes(".map((target) =>"), true);
  assert.equal(hostSource.includes("revenueTiers(effectiveEconomy)"), true);
  assert.equal(hostSource.includes("grossSupportCoins"), true);
});

test("Agency Room category and logo reuse bootstrap data without agency hot-path reads", () => {
  const main = source("lib/main.dart");
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(main.includes("agency-room-logo-button"), true);
  assert.equal(main.includes("_buildAgencyLogoButton()"), true);
  assert.equal(main.includes("viewerAgencyId == agencyId"), true);
  assert.equal(main.includes("const MyAgencyEntryPage()"), true);
  assert.equal(main.includes("joinEnabled: viewerAgencyId.isEmpty"), true);
  assert.equal(main.includes("تصنيف غرفة الوكالة ثابت: وكالة"), true);
  assert.equal(main.includes("agency-room-house-button"), false);

  assert.equal(voice.includes('agencyLogoUrl:roomType==="agency"'), true);
  assert.equal(voice.includes('category:roomType==="agency"?"وكالة"'), true);
  assert.equal(voice.includes("viewerAgencyId:clean(actor.agencyId)"), true);
  assert.equal(voice.includes("viewerAgencyRole:clean(actor.agencyRole)"), true);

  const bootstrapStart = voice.indexOf("async function roomBootstrap(");
  const bootstrapEnd = voice.indexOf("\nasync function", bootstrapStart + 10);
  const bootstrap = voice.slice(
    bootstrapStart,
    bootstrapEnd > bootstrapStart ? bootstrapEnd : undefined,
  );
  assert.equal(bootstrap.includes('collection("agencies")'), false);
});

test("Agency reviewer notifications remain actionable once and resolved afterward", () => {
  const notificationPage = source(
    "lib/features/notifications/screens/notifications_page.dart",
  );
  const notificationService = source(
    "lib/features/notifications/services/notification_service.dart",
  );
  const membership = source("cloudflare-worker/src/agency-membership.js");

  assert.equal(notificationPage.includes("item.agencyReviewAction"), true);
  assert.equal(notificationPage.includes("getReviewRequest(requestId)"), true);
  assert.equal(notificationPage.includes("respondReview("), true);
  assert.equal(notificationPage.includes("already_processed"), true);
  assert.equal(notificationService.includes("agencyReviewResolved"), true);
  assert.equal(membership.includes("resolvedReviewerNotificationWrites"), true);
  assert.equal(membership.includes('code: "already_processed"'), true);
});
