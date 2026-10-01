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
  const managerPage = source(
    "lib/features/agency/screens/agency_membership_review_page.dart",
  );
  const controlPage = source("lib/admin/agency_control_page.dart");
  const controlSource = source("cloudflare-worker/src/agency-control.js");
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
  assert.equal(managerPage.includes("agency-review-pending-"), true);
  assert.equal(managerPage.includes("maxLines: 1"), true);
  assert.equal(managerPage.includes("agency-review-copy-id-"), true);
  assert.equal(managerPage.includes("سبب الرفض — اختياري"), true);
  assert.equal(controlPage.includes("profileImageUrl"), true);
  assert.equal(
    controlSource.includes(
      "user.profileImageUrl || user.photoUrl || user.avatarUrl",
    ),
    true,
  );
});

test("Agency activity rule is fixed at 14 days x 120 minutes and removes one mic config read", () => {
  const hostSource = source("cloudflare-worker/src/agency-host.js");
  const ownerSource = source("cloudflare-worker/src/agency-owner.js");
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");
  const config = source(
    "cloudflare-worker/src/legacy-economy/gift-economy-config.js",
  );
  const policy = source("cloudflare-worker/src/economy-policy.js");

  assert.equal(hostSource.includes("const requiredQualifiedDays = 14;"), true);
  assert.equal(hostSource.includes("const requiredMinutesPerDay = 120;"), true);
  assert.equal(ownerSource.includes("const requiredQualifiedDays = 14;"), true);
  assert.equal(ownerSource.includes("const requiredMinutesPerDay = 120;"), true);
  assert.equal(voice.includes("const requiredMinutes=120;"), true);

  const micStart = voice.indexOf("export async function recordMicActivity");
  const micEnd = voice.indexOf("\nfunction zegoUserId", micStart);
  const micSource = voice.slice(micStart, micEnd);
  assert.equal(micSource.includes('doc("gift_economy")'), false);
  assert.equal(micSource.includes("newlyQualifiedByMonth"), true);
  assert.equal(micSource.includes("!wasQualified&&qualified"), true);

  assert.equal(config.includes("const hostBonusQualifiedDays=14;"), true);
  assert.equal(config.includes("const hostBonusMinutesPerQualifiedDay=120;"), true);
  assert.equal(policy.includes("const requiredDays = 14;"), true);
  assert.equal(
    policy.includes("Activity is bonus-only. It never reduces base Host or Agency shares."),
    true,
  );
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
  assert.equal(hostSource.includes(".map((target) =>"), true);
  assert.equal(hostSource.includes("revenueTiers(effectiveEconomy)"), true);
  assert.equal(hostSource.includes("grossSupportCoins"), true);
});

test("Agency Room category and logo reuse bootstrap data without agency hot-path reads", () => {
  const main = source("lib/main.dart");
  const roomList = source("lib/screens/room/room_list_screen.dart");
  const publicAgency = source(
    "lib/features/agency/screens/public_agency_page.dart",
  );
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(main.includes("agency-room-logo-button"), true);
  assert.equal(main.includes("_buildAgencyLogoButton()"), true);
  assert.equal(main.includes("viewerAgencyId: viewerAgencyId"), true);
  assert.equal(main.includes("viewerAgencyRole: viewerAgencyRole"), true);
  assert.equal(main.includes("joinEnabled: viewerAgencyId.isEmpty"), true);
  assert.equal(
    publicAgency.includes("agency-public-membership-action"),
    true,
  );
  assert.equal(
    publicAgency.includes("const MyAgencyEntryPage()"),
    true,
  );
  assert.equal(publicAgency.includes("أنت مالك هذه الوكالة"), true);
  assert.equal(publicAgency.includes("أنت مدير أول في هذه الوكالة"), true);
  assert.equal(publicAgency.includes("أنت مدير في هذه الوكالة"), true);
  assert.equal(publicAgency.includes("أنت عضو في هذه الوكالة"), true);
  assert.equal(main.includes("تصنيف غرفة الوكالة ثابت: وكالة"), true);
  assert.equal(main.includes("agency-room-house-button"), false);
  assert.equal(
    roomList.includes("if (_isAgencyRoom(room)) return 'وكالة';"),
    true,
  );

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
  assert.equal(notificationService.includes("resolvedByName"), true);
  assert.equal(notificationPage.includes("_resolvedNotificationText"), true);
  assert.equal(membership.includes("resolvedReviewerNotificationWrites"), true);
  assert.equal(membership.includes("resolvedByName"), true);
  assert.equal(membership.includes('code: "already_processed"'), true);
});
