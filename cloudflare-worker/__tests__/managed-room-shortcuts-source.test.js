import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const legacy=readFileSync(new URL('../src/voice-session-legacy.js',import.meta.url),'utf8');
const setModerator=legacy.slice(legacy.indexOf('async function setRoomModerator('),legacy.indexOf('function roomResponse('));
const managed=legacy.slice(legacy.indexOf('async function roomManagedList('),legacy.indexOf('function normalizeRoomMusicPolicy('));

test('moderator index is changed atomically only by the authorized role writer',()=>{
  assert.match(setModerator,/ownerUid!==uid\)&&!global\.manageRooms/);
  assert.match(setModerator,/tx\.update\(roomRef,/);
  assert.match(setModerator,/room_moderator_memberships/);
  assert.match(setModerator,/\.doc\(targetUid\)\.collection\("rooms"\)\.doc\(roomId\)/);
  assert.match(setModerator,/if\(enabled\)\{\s*tx\.set\(membershipRef,/);
  assert.match(setModerator,/\}else\{\s*tx\.delete\(membershipRef\)/);
  assert.match(setModerator,/tx\.create\(auditRef,/);
});

test('managed shortcut is per-user, bounded and never grants access from index alone',()=>{
  assert.match(managed,/const personalId="personal_"\+uid/);
  assert.match(managed,/room_moderator_memberships/);
  assert.match(managed,/\.limit\(30\)\.get\(\)/);
  assert.match(managed,/\.limit\(12\)\.get\(\)/);
  assert.match(managed,/unique=\[\.\.\.new Set\(candidates\)\]/);
  assert.match(managed,/\.slice\(0,54\)/);
  assert.match(managed,/roomOwnerUid\(room\)===uid/);
  assert.match(managed,/roomModeratorEntry\(room,uid\)/);
  assert.match(managed,/if\(!myRole\)continue/);
  assert.match(managed,/room\.isHidden===true/);
  assert.doesNotMatch(managed,/\.collection\("rooms"\)\s*\.where\("isActive"/);
  assert.doesNotMatch(managed,/Timer\.periodic|setInterval/);
});

test('managed shortcut remains behind authenticated voice-session action',()=>{
  assert.match(legacy,/if\(action==="roomManagedList"\)\{\s*return out\(res,200,await roomManagedList\(getFirestore\(\),decoded\.uid\)\)/);
});
