import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  validateGiftEligibility,
  giftEligibilityFailure,
  GIFT_WEALTH_MIN_LEVELS,
} from "../../cloudflare-worker/src/gift-eligibility-policy.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("gifts have exactly one server-authoritative prerequisite", () => {
  assert.deepEqual(GIFT_WEALTH_MIN_LEVELS, [0,11,16,21,26,31]);
  assert.deepEqual(validateGiftEligibility({minVipLevel: 4}), {
    minVipLevel: 4, minWealthLevel: 0,
  });
  assert.deepEqual(validateGiftEligibility({minWealthLevel: 16}), {
    minVipLevel: 0, minWealthLevel: 16,
  });
  assert.equal(giftEligibilityFailure({minVipLevel: 4},{vipLevel:3}),"vip_gift_requires_level");
  assert.equal(giftEligibilityFailure({minVipLevel: 4},{vipLevel:4}),"");
  assert.equal(giftEligibilityFailure({minWealthLevel: 21},{wealthLevel:20}),"wealth_gift_requires_level");
  assert.equal(giftEligibilityFailure({minWealthLevel: 21},{wealthLevel:31}),"");
  assert.throws(() => validateGiftEligibility({minVipLevel: 4,minWealthLevel: 11}),
    /invalid_gift_eligibility_combination/);
  assert.throws(() => validateGiftEligibility({minWealthLevel: 12}), /invalid_gift_wealth_level/);
  assert.throws(() => validateGiftEligibility({category:"vip", minWealthLevel:11}),
    /invalid_gift_eligibility_combination/);
});

test("both room and private gift transactions enforce current wealth with transaction policy", () => {
  for (const path of [
    "../../cloudflare-worker/src/room-gift.js",
    "../../cloudflare-worker/src/chat-safety-actions.js",
  ]) {
    const code=read(path);
    assert.ok(code.includes("validateGiftEligibility("),path);
    assert.ok(code.includes("loadUserLevelPolicy(db, { transaction })"),path);
    assert.ok(code.includes("wealth_gift_requires_level"),path);
    assert.ok(code.includes("vip_gift_requires_level"),path);
  }
});

test("admin edits publish only one eligibility and independent effect placements",()=>{
  const admin=read("../../lib/admin/gift_catalog_control_page.dart");
  const source=read("../../cloudflare-worker/src/legacy-economy/gift-catalog.js");
  const client=read("../../lib/features/gift/services/gift_catalog_service.dart");
  assert.ok(admin.includes("شرط مستوى الثروة"));
  assert.ok(admin.includes("أين يظهر مؤثر الهدية؟"));
  assert.ok(admin.includes("مؤثر الهدية"));
  assert.ok(admin.includes("minWealthLevel: minWealthLevel"));
  assert.ok(client.includes("'minWealthLevel': minWealthLevel"));
  assert.ok(client.includes('static String? _cachedOwnerUid'));
  assert.ok(client.includes('_cachedOwnerUid != ownerUid'));
  assert.ok(client.includes("throw StateError('gift_account_changed')"));
  assert.ok(source.includes("validateGiftEligibility("));
  assert.ok(source.includes("effectContexts"));
});

test("picker disables locked gift cards, has confirmed four-second combo",()=>{
  const ui=read("../../lib/features/gift/widgets/unified_gift_picker_sheet.dart");
  assert.ok(ui.includes("_lockedGiftLabel("));
  assert.ok(ui.includes("locked != null ? null"));
  assert.ok(ui.includes("opacity: locked == null ? 1 : .42"));
  assert.ok(ui.includes("const Duration(seconds: 4)"));
  assert.ok(ui.includes("_comboCountdown.forward(from: 0)"));
  assert.ok(ui.includes("if (confirmed == null || !mounted)"));
  assert.ok(ui.includes("_comboTotal += _quantity * _comboRecipientCount"));
  assert.ok(ui.includes("CircularProgressIndicator("));
  assert.ok(ui.includes("recipientCount: recipientCount")===false);
  const room=read("../../lib/features/gift/widgets/room_gift_sheet.dart");
  assert.ok(room.includes("recipientCount: recipientCount"));
  assert.ok(room.includes("comboContextKey:"));
});

test("room combo locks recipient selection before asynchronous reconnection",()=> {
  const room = read("../../lib/features/gift/widgets/room_gift_sheet.dart");
  const picker = read("../../lib/features/gift/widgets/unified_gift_picker_sheet.dart");
  const snapshot = room.indexOf("final modeAtTap = _recipientMode;");
  const reconnect = room.indexOf("await ensurePresence();", snapshot);
  const reject = room.indexOf("throw StateError('gift_recipients_changed');", reconnect);
  const send = room.indexOf("final result = await _gifts.send(", reconnect);
  assert.ok(snapshot >= 0 && reconnect > snapshot && reject > reconnect && send > reject);
  assert.ok(room.includes("recipientMode: modeAtTap"));
  assert.ok(room.includes("recipientIds: idsAtTap"));
  assert.ok(picker.includes("'gift_recipients_changed'"));
});

test("private effects observe existing message stream and do not replay history",()=>{
  const chat=read("../../lib/features/chat/screens/private_chat_screen.dart");
  const server=read("../../cloudflare-worker/src/chat-safety-actions.js");
  assert.ok(chat.includes("if (!_giftEffectStreamReady)"));
  assert.ok(chat.includes("DocumentChangeType.added"));
  assert.ok(chat.includes("IgnorePointer("));
  assert.ok(chat.includes("CosmeticAssetVisual("));
  assert.ok(server.includes("giftEffectEventId: chatEffect"));
  assert.ok(server.includes("effectContexts"));
});

test("partial editor progress is private, debounced and never stored as a published gift",()=>{
  const server=read("../../cloudflare-worker/src/legacy-economy/gift-catalog.js");
  const editor=read("../../lib/admin/gift_catalog_control_page.dart");
  assert.ok(server.includes('db.collection("gift_catalog_editor_drafts").doc(uid)'));
  assert.ok(server.includes('if (action === "autosaveEditor" || action === "clearEditor")'));
  assert.ok(server.includes('priorRevision !== expectedRevision'));
  assert.ok(server.includes('throw Error("gift_editor_conflict")'));
  assert.ok(server.includes('db.runTransaction(async (tx) =>'));
  assert.ok(server.includes('editorDraftRevision: nextRevision'));
  assert.ok(editor.includes('SharedPreferences.getInstance()'));
  assert.ok(editor.includes("'expectedEditorRevision': draftRevision"));
  assert.ok(editor.includes("Duration(milliseconds: 1400)"));
  assert.ok(editor.includes("تم حفظ المسودة تلقائياً"));
  assert.ok(editor.includes("استكمال"));
});
