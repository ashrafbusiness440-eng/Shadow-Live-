import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {giftAdminAccess} from "../../cloudflare-worker/src/gift-admin-permissions.js";

const owner={role:"owner"};
const finance={role:"admin",adminEnabled:true,capabilities:["manageEconomy"]};
const editor={role:"admin",adminEnabled:true,capabilities:["manageGiftCatalog"]};
const viewer={role:"moderator",adminEnabled:true,capabilities:["viewGiftStats"]};
const closed={role:"admin",adminEnabled:false,capabilities:["manageGiftCatalog","viewGiftStats","manageEconomy"]};

test("owner and legacy economy editor retain previous rights",()=>{
  for(const user of [owner,finance]){
    for(const action of ["state","statsRecent","save","saveCategories","saveDraft","publishDraft","discardDraft","grantBagGift"]){
      assert.equal(giftAdminAccess(user,action).allowed,true, action);
    }
  }
});

test("gift editor can modify catalog but cannot mint bag gifts or broader economy",()=>{
  for(const action of ["state","statsRecent","save","saveCategories","saveDraft","publishDraft","discardDraft"]){
    assert.equal(giftAdminAccess(editor,action).allowed,true,action);
  }
  assert.equal(giftAdminAccess(editor,"grantBagGift").allowed,false);
  assert.equal(giftAdminAccess(editor,"adjustBalance").allowed,false);
  assert.equal(giftAdminAccess(editor,"state").statsOnly,false);
});

test("report viewer has no access to drafts or any mutation",()=>{
  assert.deepEqual(giftAdminAccess(viewer,"state"),{allowed:true,statsOnly:true});
  assert.equal(giftAdminAccess(viewer,"statsRecent").allowed,true);
  for(const action of ["save","saveCategories","saveDraft","publishDraft","discardDraft","grantBagGift"]){
    assert.equal(giftAdminAccess(viewer,action).allowed,false,action);
  }
});
test("disabled admin, user role, missing cap, unknown action are denied",()=>{
  assert.equal(giftAdminAccess(closed,"save").allowed,false);
  assert.equal(giftAdminAccess(closed,"statsRecent").allowed,false);
  assert.equal(giftAdminAccess({role:"user"},"statsRecent").allowed,false);
  assert.equal(giftAdminAccess({role:"admin",adminEnabled:true},"save").allowed,false);
  assert.equal(giftAdminAccess(owner,"everything").allowed,false);
});

test("server checks action-specific access before config and finance writes",()=>{
  const code=readFileSync(new URL("../../cloudflare-worker/src/legacy-economy/gift-catalog.js",import.meta.url),"utf8");
  assert.match(code,/giftAdminAccess\(user, action\)/);
  assert.match(code,/if \(!access\.allowed\) throw Error\("forbidden"\)/);
  assert.match(code,/if \(statsOnly\) \{/);
  assert.match(code,/config: null/);
});
