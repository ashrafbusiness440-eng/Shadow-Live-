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
  assert.equal(ownerPage.includes("owner-agency-member-${member.uid}"), true);
  assert.equal(ownerPage.includes("owner-member-copy-id-"), true);
  assert.equal(ownerPage.includes("owner-member-performance-"), true);
  assert.equal(ownerPage.includes("trailing: owner"), false);
  assert.equal(ownerPage.includes("owner-agency-copy-id"), true);
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
    policy.includes("They must never inflate the base gift-time Host or Agency share."),
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
  assert.equal(hostPage.includes("Target المحتسب للمضيف:"), true);
  assert.equal(hostPage.includes("Host Share:"), false);
  assert.equal(hostPage.includes("Activity Bonus:"), true);
  assert.equal(hostPage.includes("activityBonusBps"), false);
  assert.equal(hostPage.includes("شرط النشاط:"), true);
  assert.equal(hostPage.includes("تقدم المستوى التالي:"), true);
  assert.equal(hostSource.includes(".map((target) =>"), true);
  assert.equal(hostSource.includes("revenueTiers(effectiveEconomy)"), true);
  assert.equal(hostSource.includes("grossSupportCoins"), true);
});

test("Agency ID copy actions stay available across member-facing Agency screens", () => {
  const hostPage = source(
    "lib/features/agency/screens/host_my_agency_page.dart",
  );
  const publicAgency = source(
    "lib/features/agency/screens/public_agency_page.dart",
  );
  const ownerPage = source(
    "lib/features/agency/screens/owner_agency_dashboard_page.dart",
  );

  assert.equal(hostPage.includes("host-agency-copy-id"), true);
  assert.equal(publicAgency.includes("public-agency-copy-id"), true);
  assert.equal(ownerPage.includes("owner-agency-copy-id"), true);
  assert.equal(hostPage.includes("Clipboard.setData"), true);
  assert.equal(publicAgency.includes("Clipboard.setData"), true);
  assert.equal(ownerPage.includes("Clipboard.setData"), true);
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
  assert.equal(voice.includes("agencyRoomImageUrl:"), true);
  assert.equal(voice.includes("agencyRoomImageObjectId:"), true);
  assert.equal(main.includes("String get _roomHeaderImageUrl"), true);
  assert.equal(main.includes("_roomArguments['agencyRoomImageUrl']"), true);
  assert.equal(main.includes("NetworkImage(\n                                                  _roomHeaderImageUrl,"), true);
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
  assert.equal(notificationService.includes("resolvedAt"), true);
  assert.equal(notificationPage.includes("_resolvedNotificationText"), true);
  assert.equal(membership.includes("resolvedReviewerNotificationWrites"), true);
  assert.equal(membership.includes("resolvedByName"), true);
  assert.equal(membership.includes('code: "already_processed"'), true);
});


test("Agency business periods use Riyadh boundaries and daily activity cap", () => {
  const agencyPolicy = source("cloudflare-worker/src/agency-policy.js");
  const mic = source("cloudflare-worker/src/mic-activity.js");
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");
  const roomGift = source("cloudflare-worker/src/room-gift.js");
  const chatGift = source("cloudflare-worker/src/chat-safety-actions.js");
  const config = source(
    "cloudflare-worker/src/legacy-economy/gift-economy-config.js",
  );

  assert.equal(agencyPolicy.includes("3 * 60 * 60 * 1000"), true);
  assert.equal(mic.includes("RIYADH_OFFSET_MS"), true);
  assert.equal(mic.includes("splitRiyadhIntervalByDay"), true);
  assert.equal(voice.includes("nextEligibleSeconds-previousEligibleSeconds"), true);
  assert.equal(roomGift.includes("const agencyPeriods = riyadhPeriodKeys(now);"), true);
  assert.equal(chatGift.includes("const agencyPeriods = riyadhPeriodKeys(now);"), true);
  assert.equal(config.includes('periodTimeZone:"Asia/Riyadh"'), true);
});

test("Approved bonuses are month-end only and legacy +2 percent is absent", () => {
  const policy = source("cloudflare-worker/src/economy-policy.js");
  const hostSource = source("cloudflare-worker/src/agency-host.js");
  const hostPage = source(
    "lib/features/agency/screens/host_my_agency_page.dart",
  );
  const giftControl = source("lib/admin/gift_economy_control_page.dart");

  assert.equal(policy.includes("const hostBonusBps = 0;"), true);
  assert.equal(policy.includes("const agencyBonusBps = 0;"), true);
  assert.equal(hostSource.includes("hostActivityBonusForTarget(summary)"), true);
  assert.equal(hostPage.includes("Activity Bonus: +"), false);
  assert.equal(
    giftControl.includes("per_host_target_month_end"),
    true,
  );
  assert.equal(
    giftControl.includes("gift-economy-host-bonus-pct"),
    false,
  );
});


test("Agency legacy economy migration fallback cannot restore UTC or +2 percent", () => {
  const config = source(
    "cloudflare-worker/src/legacy-economy/gift-economy-config.js",
  );
  assert.equal(config.includes("function safePolicyFallback(data={})"), true);
  assert.equal(config.includes('periodTimeZone:"Asia/Riyadh"'), true);
  assert.equal(config.includes("hostPerformanceBonusBps:0"), true);
  assert.equal(
    config.includes('agencyPerformanceBonusMode:"per_host_target_month_end"'),
    true,
  );
  assert.equal(
    config.includes(
      'clean(data.agencyPerformanceBonusMode)==="per_host_target_month_end"',
    ),
    true,
  );
  assert.equal(config.includes(":100;"), true);
});


test("Agency permission and status notifications are mandatory", () => {
  const membership = source("cloudflare-worker/src/agency-membership.js");
  const control = source("cloudflare-worker/src/agency-control.js");

  const roleStart = membership.indexOf(
    'type: "agency_membership_role_changed"',
  );
  const roleEnd = membership.indexOf("createdAt: now", roleStart);
  assert.ok(roleStart >= 0 && roleEnd > roleStart);
  assert.equal(
    membership.slice(roleStart, roleEnd).includes("mandatory: true"),
    true,
  );

  const statusStart = control.indexOf(
    'db.writeCreate(\`notifications/agency_status_\${eventId}\`',
  );
  const statusEnd = control.indexOf("createdAt: now", statusStart);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  assert.equal(
    control.slice(statusStart, statusEnd).includes("mandatory: true"),
    true,
  );
});


test("Agency manager Host performance stays privacy-safe and lazy", () => {
  const managerPage = source(
    "lib/features/agency/screens/agency_membership_review_page.dart",
  );
  const service = source(
    "lib/features/agency/services/owner_agency_service.dart",
  );
  const membership = source("cloudflare-worker/src/agency-membership.js");

  assert.equal(managerPage.includes("agency-manager-load-members"), true);
  assert.equal(managerPage.includes("agency-manager-member-"), true);
  assert.equal(managerPage.includes("_membersData == null"), true);
  assert.equal(managerPage.includes("loadManagerHostPerformance"), true);
  assert.equal(
    managerPage.includes("الرواتب وAgency Share وBonus وبيانات المحفظة مخفية"),
    true,
  );

  assert.equal(service.includes("'action': 'memberPerformance'"), true);
  assert.equal(
    service.includes("class ManagerHostPerformanceData"),
    true,
  );

  const start = membership.indexOf(
    "export async function loadAgencyMemberPerformance",
  );
  const end = membership.indexOf(
    "export async function listAgencyMembers",
    start,
  );
  const segment = membership.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(segment.includes(".runQuery("), false);
  assert.equal(segment.includes('collection("agency_wallets")'), false);
  assert.equal(segment.includes("financial_ledger"), false);
  assert.equal(segment.includes("salaryDiamonds"), false);
  assert.equal(segment.includes("paidDiamonds"), false);
  assert.equal(segment.includes("agencyShare"), false);
  assert.equal(segment.includes("agencyBonus"), false);
  assert.equal(
    segment.includes('privacyMode: "manager_performance_only"'),
    true,
  );
});


test("Agency personal Target history stays bounded and immutable", () => {
  const host = source("cloudflare-worker/src/agency-host.js");
  const policy = source("cloudflare-worker/src/agency-policy.js");
  const roomGift = source("cloudflare-worker/src/room-gift.js");
  const chatGift = source("cloudflare-worker/src/chat-safety-actions.js");
  const page = source(
    "lib/features/agency/screens/host_my_agency_page.dart",
  );

  const start = host.indexOf(
    "export async function loadAgencyHostTargetHistory",
  );
  const end = host.indexOf(
    "export async function updateAgencyOwnerProfile",
    start,
  );
  const history = host.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(history.includes('db.runQuery("gift_transactions"'), true);
  assert.equal(history.includes("limit: 30"), true);
  assert.equal(history.includes(".snapshots()"), false);
  assert.equal(history.includes("Timer.periodic"), false);
  assert.equal(history.includes('collection("agency_wallets")'), false);
  assert.equal(
    policy.includes("export function agencyTargetAchievementDeltas"),
    true,
  );
  assert.equal(roomGift.includes("agencyTargetAchievements"), true);
  assert.equal(chatGift.includes("agencyTargetAchievements"), true);
  assert.equal(page.includes("host-agency-target-history-entry"), true);
  assert.equal(page.includes("سجل الـTargets الشخصي"), true);
});


test("Agency 7-day cooldown exception stays explicit and bounded", () => {
  const membership = source("cloudflare-worker/src/agency-membership.js");
  const control = source("cloudflare-worker/src/agency-control.js");
  const entry = source(
    "lib/features/agency/screens/my_agency_entry_page.dart",
  );
  const service = source(
    "lib/features/agency/services/agency_membership_service.dart",
  );
  const controlPage = source("lib/admin/agency_control_page.dart");

  assert.equal(
    membership.includes("export async function requestAgencyCooldownException"),
    true,
  );
  assert.equal(
    membership.includes("agency_cooldown_exception_requests/"),
    true,
  );
  assert.equal(
    membership.includes("cooldownActive"),
    true,
  );
  assert.equal(
    control.includes("export async function listAgencyCooldownExceptionRequests"),
    true,
  );
  const listStart = control.indexOf(
    "export async function listAgencyCooldownExceptionRequests",
  );
  const listEnd = control.indexOf(
    "async function finalizeAgencyCooldownExceptionReview",
    listStart,
  );
  const listSegment = control.slice(listStart, listEnd);
  assert.equal(listSegment.includes("limit = Math.min(25"), true);
  assert.equal(listSegment.includes(".runQuery("), true);
  assert.equal(control.includes('action === "reviewCooldownException"'), true);
  assert.equal(service.includes("'action': 'requestCooldownException'"), true);
  assert.equal(entry.includes("agency-cooldown-exception-request"), true);
  assert.equal(
    controlPage.includes("طلبات استثناء انتظار 7 أيام"),
    true,
  );
});


test("Agency room image editor uses real square crop with circle-only room preview", () => {
  const hostPage = source(
    "lib/features/agency/screens/host_my_agency_page.dart",
  );
  const cropSheet = source(
    "lib/features/agency/widgets/agency_room_image_crop_sheet.dart",
  );

  assert.equal(hostPage.includes("owner-agency-room-image-edit-entry"), true);
  assert.equal(hostPage.includes("تعديل صورة غرفة الوكالة"), true);
  assert.equal(hostPage.includes("خلفيات الغرفة من «مقتنياتي»"), true);
  assert.equal(hostPage.includes("scope: 'agency_room_image'"), true);
  assert.equal(hostPage.includes("scope: 'agency_background'"), false);
  assert.equal(hostPage.includes("تعديل خلفية الوكالة"), false);

  assert.equal(cropSheet.includes("aspectRatio: 1"), true);
  assert.equal(cropSheet.includes("fixCropRect: true"), true);
  assert.equal(cropSheet.includes("interactive: true"), true);
  assert.equal(cropSheet.includes("BoxShape.circle"), true);
  assert.equal(cropSheet.includes("_cropController.crop();"), true);
  assert.equal(cropSheet.includes("cropCircle"), false);
  assert.equal(
    cropSheet.includes("المربع هو القص الفعلي المحفوظ"),
    true,
  );
  assert.equal(
    cropSheet.includes("الدائرة معاينة فقط"),
    true,
  );
});
