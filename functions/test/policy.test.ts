import assert from "node:assert/strict";
import test from "node:test";
import {isRecentAuth,ownerTargetProtected,sanitizeCapabilities,validIdempotencyKey,validRole} from "../src/policy.js";

test("valid roles are explicit",()=>{assert.equal(validRole("owner"),true);assert.equal(validRole("root"),false);});
test("owner target protection blocks lower roles",()=>{assert.equal(ownerTargetProtected("admin","owner","demote"),true);assert.equal(ownerTargetProtected("owner","owner","demote"),true);assert.equal(ownerTargetProtected("owner","owner","view"),false);});
test("capabilities are deduplicated and unknown values rejected",()=>{assert.deepEqual(sanitizeCapabilities(["manageUsers","manageUsers","viewUsers"]),["manageUsers","viewUsers"]);assert.throws(()=>sanitizeCapabilities(["rootAccess"]),/invalid_capability/);});
test("idempotency keys use safe document ids",()=>{assert.equal(validIdempotencyKey("abcdefghijklmnop"),true);assert.equal(validIdempotencyKey("abc/def"),false);assert.equal(validIdempotencyKey("short"),false);});
test("recent auth accepts at boundary and rejects stale or future tokens",()=>{const now=2000;assert.equal(isRecentAuth(1400,now),true);assert.equal(isRecentAuth(1399,now),false);assert.equal(isRecentAuth(2001,now),false);assert.equal(isRecentAuth(0,now),false);});
