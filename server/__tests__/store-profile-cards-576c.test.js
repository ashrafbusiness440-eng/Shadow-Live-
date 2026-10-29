import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {resolveStoreVisuals} from "../../cloudflare-worker/src/store-presentation.js";

const uid="profile_card_owner";
const now=1761740000000;
const item=(changes={})=>({
  ownerUid:uid,productId:"200006",category:"profileCards",
  source:"admin_grant",status:"active",
  assetKey:"store.item.200006.icon",
  acquiredAtMs:now-1000,expiresAtMs:now+50000,
  equipped:true,...changes,
});
function fixture(changes={}){
  const records=new Map([
    ["user_store_equipped/"+uid,
      {ownerUid:uid,slots:{profileCards:"200006"}}],
    ["user_store_entitlements/"+uid+"/items/200006",item()],
    ["app_asset_registry/store.item.200006.visual",
      {published:true,rawUrl:"https://example.test/profile-card.webp"}],
  ]);
  const reads=[];
  const db={get:async path=>{
    reads.push(path);
    return records.has(path)
      ? {exists:true,data:records.get(path)}
      : {exists:false,data:null};
  }};
  for(const [path,patch] of Object.entries(changes))
    Object.assign(records.get(path),patch);
  return {db,records,reads};
}
const resolve=(db)=>resolveStoreVisuals(db,uid,now,
  ["frames","entranceEffects","chatBubbles","nameEffects","profileCards"]);

test("profile card is projected only from owner equipment and published .visual",async()=>{
  const {db,reads}=fixture();
  const result=await resolve(db);
  assert.equal(result.profileCards.assetKey,"store.item.200006.visual");
  assert.equal(result.profileCards.imageUrl,
    "https://example.test/profile-card.webp");
  assert.equal(result.profileCards.expiresAtMs,now+50000);
  assert.deepEqual(reads,[
    "user_store_equipped/"+uid,
    "user_store_entitlements/"+uid+"/items/200006",
    "app_asset_registry/store.item.200006.visual",
  ]);
  assert.equal(JSON.stringify(result).includes("ownerUid"),false);
  assert.equal(reads.some(x=>x.includes(".icon")||
    x.startsWith("financial_ledger")||x.startsWith("users/")),false);
});

test("expired, revoked, foreign, wrong-category and unequipped cards fail closed",async()=>{
  for(const patch of [
    {expiresAtMs:now},{status:"revoked"},{equipped:false},
    {ownerUid:"different_user"},{category:"frames"},
    {assetKey:"store.item.200006.visual"},
  ]){
    const f=fixture();
    Object.assign(f.records.get(
      "user_store_entitlements/"+uid+"/items/200006"),patch);
    assert.equal((await resolve(f.db)).profileCards,undefined,
      JSON.stringify(patch));
  }
  for(const patch of [
    {published:false},{rawUrl:"http://insecure.test/image.webp"},
    {rawUrl:""},
  ]){
    const f=fixture();
    Object.assign(f.records.get(
      "app_asset_registry/store.item.200006.visual"),patch);
    assert.equal((await resolve(f.db)).profileCards,undefined);
  }
  const f=fixture();
  f.records.get("user_store_equipped/"+uid).slots={};
  assert.deepEqual(await resolve(f.db),{});
  assert.deepEqual(f.reads,["user_store_equipped/"+uid]);
});

test("room resolver stays bounded to its four existing cosmetic categories",async()=>{
  const f=fixture();
  assert.deepEqual(await resolveStoreVisuals(f.db,uid,now),{});
  assert.deepEqual(f.reads,["user_store_equipped/"+uid]);
});

test("profile card is wired only to existing trusted profile UI",()=>{
  const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
  const backend=read("../../cloudflare-worker/src/store-presentation.js");
  const service=read("../../lib/features/store/services/store_visual_presentation_service.dart");
  const backdrop=read("../../lib/features/profile/widgets/store_verified_profile_card_backdrop.dart");
  const quick=read("../../lib/features/profile/widgets/quick_profile_sheet.dart");
  const full=read("../../lib/features/profile/screens/public_profile_screen.dart");
  const control=read("../../lib/admin/store_catalog_control_page.dart");
  assert.match(backend,/PROFILE_VISUAL_CATEGORIES/);
  assert.match(backend,/resolveStoreVisuals\(\s*db,uid,Date\.now\(\),PROFILE_VISUAL_CATEGORIES\)/);
  assert.match(service,/loadProfileCard\(String uid\)/);
  assert.match(backdrop,/service\.loadProfileCard\(uid\)/);
  assert.match(backdrop,/visual\.activeNow/);
  assert.match(quick,/StoreVerifiedProfileCardBackdrop\(/);
  assert.match(full,/StoreVerifiedProfileCardBackdrop\(/);
  assert.match(control,/selectedCategory == 'profileCards'/);
});
