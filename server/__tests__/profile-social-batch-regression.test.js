import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relative) {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}

test("profile mood reuses existing bounded profile sync", () => {
  const firebase = source("lib/shared/services/firebase_service.dart");
  const edit = source("lib/features/user/screens/edit_profile_screen.dart");
  const rules = source("firestore.rules");

  assert.equal(firebase.includes("'moodEmoji':data['moodEmoji']??''"), true);
  assert.equal(firebase.includes("'moodText':data['moodText']??''"), true);
  assert.equal(edit.includes("_moodEmoji=TextEditingController()"), true);
  assert.equal(edit.includes("_moodText=TextEditingController()"), true);
  assert.equal(edit.includes("'moodEmoji':_moodEmoji.text.trim()"), true);
  assert.equal(edit.includes("'moodText':_moodText.text.trim()"), true);

  assert.equal(rules.includes("request.resource.data.get('moodEmoji', '') is string"), true);
  assert.equal(rules.includes("request.resource.data.get('moodText', '') is string"), true);
  assert.equal(rules.includes("get('moodText', '').size() <= 80"), true);
});

test("public and quick profiles render mood and existing interests", () => {
  const publicProfile = source(
    "lib/features/profile/screens/public_profile_screen.dart",
  );
  const quickProfile = source(
    "lib/features/profile/widgets/quick_profile_sheet.dart",
  );

  assert.equal(publicProfile.includes("data['moodEmoji']"), true);
  assert.equal(publicProfile.includes("data['moodText']"), true);
  assert.equal(publicProfile.includes("data['interests']"), true);
  assert.equal(publicProfile.includes("_interestsCard(interests)"), true);
  assert.equal(publicProfile.includes("'عرض الكل ('"), true);

  assert.equal(quickProfile.includes("data['moodEmoji']"), true);
  assert.equal(quickProfile.includes("data['moodText']"), true);
  assert.equal(quickProfile.includes("final mood = ["), true);
});

test("profile quick batch does not add posts backend or extra profile listeners", () => {
  const firebase = source("lib/shared/services/firebase_service.dart");
  const publicProfile = source(
    "lib/features/profile/screens/public_profile_screen.dart",
  );
  const quickProfile = source(
    "lib/features/profile/widgets/quick_profile_sheet.dart",
  );

  const combined = firebase + publicProfile + quickProfile;
  assert.equal(combined.includes("collection('posts')"), false);
  assert.equal(combined.includes('collection("posts")'), false);
  assert.equal(
    publicProfile.includes(
      "future: FirebaseFirestore.instance.collection('public_profiles').doc(widget.userId).get()",
    ),
    true,
  );
  assert.equal(
    quickProfile.includes(
      "future: FirebaseFirestore.instance.collection('public_profiles').doc(widget.userId).get()",
    ),
    true,
  );
});

test("profile quick batch preserves legacy level migration", () => {
  const firebase = source("lib/shared/services/firebase_service.dart");
  const publicProfile = source(
    "lib/features/profile/screens/public_profile_screen.dart",
  );
  const quickProfile = source(
    "lib/features/profile/widgets/quick_profile_sheet.dart",
  );

  assert.equal(firebase.includes("'level':data['level']"), false);
  assert.equal(publicProfile.includes("data['level']"), false);
  assert.equal(quickProfile.includes("data['level']"), false);
  assert.equal(quickProfile.includes("level.badge."), false);
});
