import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relative) {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}

test("profile mood reuses the existing profile sync and stays bounded", () => {
  const firebase = source("lib/shared/services/firebase_service.dart");
  const edit = source("lib/features/user/screens/edit_profile_screen.dart");
  const rules = source("firestore.rules");

  assert.equal(firebase.includes("'moodEmoji':data['moodEmoji']??''"), true);
  assert.equal(firebase.includes("'moodText':data['moodText']??''"), true);
  assert.equal(
    firebase.includes("collection('public_profiles').doc(userId).set"),
    true,
  );

  assert.equal(edit.includes("_moodEmoji=TextEditingController()"), true);
  assert.equal(edit.includes("_moodText=TextEditingController()"), true);
  assert.equal(edit.includes("'moodEmoji':_moodEmoji.text.trim()"), true);
  assert.equal(edit.includes("'moodText':_moodText.text.trim()"), true);
  assert.equal(edit.includes("maxLength:40"), true);

  assert.equal(rules.includes("request.resource.data.moodEmoji is string"), true);
  assert.equal(rules.includes("request.resource.data.moodEmoji.size() <= 16"), true);
  assert.equal(rules.includes("request.resource.data.moodText is string"), true);
  assert.equal(rules.includes("request.resource.data.moodText.size() <= 80"), true);
});

test("public and quick profiles render mood from their existing snapshots", () => {
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

test("profile quick batch does not invent a posts backend or realtime profile listener", () => {
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
