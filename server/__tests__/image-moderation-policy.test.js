import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  defaultImageModerationPolicy, validateImageModerationPolicy,
  imageModerationApplies, imageModerationProviderReady,
  classifyGoogleSafeSearch, moderatedImageDecision,
  runImageModerationProvider,
} from "../../cloudflare-worker/src/image-moderation-policy.js";
import {
  saveImageModerationConfiguration, IMAGE_MODERATION_PUBLICATION_GATE_READY,
} from "../../cloudflare-worker/src/image-moderation-control.js";

const config=(x={})=>({
  enabled:false, scope:"public", mode:"free",
  provider:"cloudflare_vision", dailyLimit:20, ...x,
});
class MemoryDb {
  constructor(){this.docs=new Map();this.writes=[];}
  async beginTransaction(){return "tx";}
  async rollback(){}
  async get(path){return {exists:this.docs.has(path),
    data:this.docs.get(path)||null};}
  writeUpdate(path,data){return {path,data,op:"update"};}
  writeCreate(path,data){return {path,data,op:"create"};}
  async commit(_tx,writes){for(const w of writes){
    if(w.op==="create"&&this.docs.has(w.path))throw Error("exists");
    this.docs.set(w.path,{...(this.docs.get(w.path)||{}),...w.data});
    this.writes.push(w);
  }}
}
test("U6-L1 default OFF and general-only, mode matches vetted registry",()=>{
  assert.deepEqual(defaultImageModerationPolicy(),{...config(),version:0});
  assert.deepEqual(validateImageModerationPolicy(config()),config());
  assert.throws(()=>validateImageModerationPolicy(config({
    mode:"paid",provider:"cloudflare_vision",
  })),/invalid_image_moderation_policy/);
  assert.throws(()=>validateImageModerationPolicy(config({
    provider:"unknown",
  })),/invalid_image_moderation_policy/);
  assert.throws(()=>validateImageModerationPolicy(config({
    dailyLimit:100001,
  })),/invalid_image_moderation_policy/);
  assert.throws(()=>validateImageModerationPolicy(config({
    mode:"paid",provider:"google_safesearch",enabled:true,
  })),/invalid_image_moderation_policy/);
  assert.equal(IMAGE_MODERATION_PUBLICATION_GATE_READY,false);
});

test("U6-L1 exact scopes; chat opt-in applies only on new uploads",()=>{
  assert.equal(imageModerationApplies(config(),"profile_image"),false);
  const policy=config({enabled:true});
  for(const scope of ["profile_image","profile_cover","room_cover",
    "diary_image","agency_logo","agency_background","agency_room_image",
    "profile_avatar_animation"]) {
    assert.equal(imageModerationApplies(policy,scope),true);
  }
  assert.equal(imageModerationApplies(policy,"chat_image"),false);
  assert.equal(imageModerationApplies({...policy,scope:"public_and_private"},
    "chat_image"),true);
  assert.equal(imageModerationApplies(policy,"unknown"),false);
});

test("U6-L1 Google's known categories only: high confidence block, uncertain review",()=>{
  const data=(risk)=>({responses:[{safeSearchAnnotation:risk}]});
  assert.equal(classifyGoogleSafeSearch(data({
    adult:"VERY_LIKELY",violence:"UNLIKELY",racy:"UNLIKELY",
  })).status,"blocked");
  assert.equal(classifyGoogleSafeSearch(data({
    adult:"UNLIKELY",violence:"LIKELY",racy:"UNLIKELY",
  })).status,"needs_review");
  assert.equal(classifyGoogleSafeSearch(data({
    adult:"UNLIKELY",violence:"UNLIKELY",racy:"VERY_LIKELY",
  })).status,"needs_review");
  assert.equal(classifyGoogleSafeSearch(data({
    adult:"VERY_UNLIKELY",violence:"VERY_UNLIKELY",racy:"UNLIKELY",
  })).status,"approved");
  assert.equal(classifyGoogleSafeSearch({responses:[{error:"quota"}]}).status,
    "needs_review");
  assert.equal(classifyGoogleSafeSearch({}).status,"needs_review");
  assert.equal(moderatedImageDecision({status:"SAFE"}).status,"needs_review");
});

test("U6-L1 no unconfigured provider or animation passes as safe",async()=>{
  const p=config();
  assert.equal(imageModerationProviderReady({},p.provider),false);
  assert.equal(imageModerationProviderReady({AI:{run:async()=>({})}},p.provider),true);
  const bytes=Buffer.from([0xff,0xd8,0xff,0xd9]);
  assert.equal((await runImageModerationProvider({},p,{
    mimeType:"image/jpeg",bytes,
  })).status,"needs_review");
  assert.equal((await runImageModerationProvider({AI:{run:async()=>({})}},p,{
    mimeType:"image/gif",bytes,
  })).status,"needs_review");
  const ai={run:async(_model,input)=>{
    assert.ok(input.image.startsWith("data:image/jpeg;base64,"));
    return {response:"SAFE"};
  }};
  assert.equal((await runImageModerationProvider({AI:ai},p,{
    mimeType:"image/jpeg",bytes,
  })).status,"approved");
  assert.equal((await runImageModerationProvider({
    AI:{run:async()=>{throw Error("quota");}},
  },p,{mimeType:"image/jpeg",bytes})).status,"needs_review");
});

test("U6-L1 update remains disabled with version, audit and idempotency",async()=>{
  const db=new MemoryDb();
  const payload={
    idempotencyKey:"test_mod_policy_12345",
    reason:"Owner preparing future image moderation",
    expectedVersion:0,
    config:config({scope:"public_and_private"}),
  };
  const first=await saveImageModerationConfiguration(db,"owner_1",payload);
  assert.equal(first.config.enabled,false);
  assert.equal(first.config.version,1);
  assert.equal(db.docs.get("system_config/image_moderation").scope,
    "public_and_private");
  assert.equal(db.writes.filter(w=>w.path.startsWith("admin_audit_logs/")).length,1);
  const again=await saveImageModerationConfiguration(db,"owner_1",payload);
  assert.equal(again.duplicate,true);
  await assert.rejects(()=>saveImageModerationConfiguration(db,"owner_2",payload),
    /idempotency_conflict/);
  await assert.rejects(()=>saveImageModerationConfiguration(db,"owner_1",{
    ...payload,idempotencyKey:"test_mod_policy_22222",
  }),/version_conflict/);
  await assert.rejects(()=>saveImageModerationConfiguration(db,"owner_1",{
    ...payload,idempotencyKey:"test_mod_policy_33333",
    expectedVersion:1, config:config({enabled:true}),
  }),/publication_gate_not_ready/);
  assert.equal(db.docs.get("system_config/image_moderation").enabled,false);
});

test("U6-L1 Worker, Wrangler and owner settings never claim scanning already live",()=>{
  const route=fs.readFileSync("cloudflare-worker/src/index.js","utf8");
  const toml=fs.readFileSync("cloudflare-worker/wrangler.toml","utf8");
  const screen=fs.readFileSync("lib/admin/image_moderation_settings_page.dart","utf8");
  const reports=fs.readFileSync("lib/admin/system_reports_control_page.dart","utf8");
  assert.match(route,/api\/image-moderation-control/);
  assert.match(toml,/\[ai\]\s+binding = "AI"/);
  assert.match(screen,/enabled': _enabled/);
  assert.match(screen,/canEnable = _gateReady/);
  assert.match(screen,/paidAcknowledged/);
  assert.match(screen,/الحماية غير مفعّلة/);
  assert.match(reports,/ImageModerationSettingsPage/);
  assert.equal(screen.includes("GOOGLE_VISION_API_KEY"),false);
  assert.equal(screen.includes("setInterval"),false);
});
