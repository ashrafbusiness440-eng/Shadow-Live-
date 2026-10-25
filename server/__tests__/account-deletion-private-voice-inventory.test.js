import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {inspectAccountPrivateVoicePage as inspect,
  MAX_PRIVATE_VOICE_INVENTORY_PAGE}
  from "../../cloudflare-worker/src/account-deletion-private-voice-inventory.js";

const uid="deleted_voice_user",peer="other_voice_user";
const requestId="deletion_voice_request_1234";
const conversationId="conversation_voice_1234";
const actor={owner:true,uid:"shadow_owner_987"};
const rp="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const up="users/"+uid;
const chat="conversations/"+conversationId;
const id=i=>i.toString(16).padStart(32,"0");
const voice=i=>"voice_"+id(i);
const key=i=>`private-voice/${conversationId}/${uid}/${id(i)}.wav`;
class Db{
  constructor(){
    this.docs=new Map([
      [rp,{uid,requestId,status:"review_ready"}],
      [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      [up,{role:"user",coins:500}],
      [chat,{participants:[uid,peer]}],
    ]);
    this.queries=[];this.writes=0;
  }
  add(i,state="sent"){
    this.docs.set("private_voice_objects/"+id(i),{
      objectId:id(i),ownerUid:uid,otherUid:peer,conversationId,
      storageKey:key(i),mimeType:"audio/wav",expectedSizeBytes:32044,
      durationSeconds:1,state,createdAt:new Date(),
      ...(state==="sent"?{messageId:voice(i),sentAt:new Date()}:{}),
    });
    if(state==="sent")this.docs.set(chat+"/messages/"+voice(i),{
      type:"voice_note",senderId:uid,receiverId:peer,
      storageObjectId:id(i),mimeType:"audio/wav",sizeBytes:32044,
      durationSeconds:1,createdAt:new Date(),
    });
    else this.docs.set("private_voice_drafts/"+id(i),{
      objectId:id(i),ownerUid:uid,storageKey:key(i),expiresAt:new Date(),
      createdAt:new Date(),
    });
  }
  async get(path){return {exists:this.docs.has(path),
    data:this.docs.get(path)??null};}
  async runQuery(collection,opts){
    this.queries.push({collection,opts});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([p,d])=>
      p.startsWith(prefix)&&!p.slice(prefix.length).includes("/")&&
      d.ownerUid===opts.filters[0].value)
      .map(([p,data])=>({id:p.slice(prefix.length),data}))
      .sort((a,b)=>a.id.localeCompare(b.id));
    if(opts.startAfter.length){
      const cursor=opts.startAfter[0].referencePath.slice(prefix.length);
      rows=rows.filter(row=>row.id>cursor);
    }
    return rows.slice(0,opts.limit);
  }
}
const run=(db,opts={})=>inspect(db,{uid,requestId,actor,...opts});

test("indexed read-only 5/3 voice metadata pages contain no keys, peer IDs or media",async()=>{
  const db=new Db();
  for(let i=1;i<=8;i++)db.add(i,i%2?"sent":"uploaded");
  let cursor=null;const items=[];
  for(let page=0;page<2;page++){
    const result=await run(db,{cursor});
    assert.equal(result.completionVerified,false);
    assert.equal(result.erasureAllowed,false);
    assert.equal(result.exhaustive,false);
    assert.equal(JSON.stringify(result).includes("private-voice/"),false);
    assert.equal(JSON.stringify(result).includes(peer),false);
    items.push(...result.items);
    cursor=result.nextCursor;
  }
  assert.equal(items.length,8);
  assert.equal(cursor,null);
  assert.equal(items.every(x=>x.needsReview===false),true);
  assert.deepEqual(db.queries.map(x=>x.opts.limit),[6,6]);
  assert.equal(db.docs.get(up).coins,500);
  assert.equal(db.writes,0);
});
test("missing draft, wrong R2 key, mismatched voice message and evidence flag marked for review",async()=>{
  const db=new Db();
  db.add(1,"uploaded");db.add(2,"sent");
  db.add(3,"sent");db.add(4,"pending_upload");
  db.docs.delete("private_voice_drafts/"+id(1));
  db.docs.get("private_voice_objects/"+id(2)).storageKey="other-user/secret.wav";
  db.docs.get(chat+"/messages/"+voice(3)).receiverId="unrelated_peer_987";
  db.docs.get("private_voice_drafts/"+id(4)).evidenceHold=true;
  const page=await run(db);
  assert.equal(page.items.length,4);
  assert.deepEqual(page.items.map(x=>x.needsReview),[true,true,true,true]);
  assert.equal(page.items[1].state,"schema_review");
  assert.equal(page.needsReview,true);
  assert.equal(JSON.stringify(page).includes("secret.wav"),false);
});
test("moderation marker, sent draft, old schema and cleanup-in-flight require review",async()=>{
  const db=new Db();for(let i=1;i<=4;i++)db.add(i,i===4?"deleting":"sent");
  db.docs.set("content_filter_flags/"+voice(1),{evidence:"protected"});
  db.docs.set("private_voice_drafts/"+id(2),{
    objectId:id(2),ownerUid:uid,storageKey:key(2)});
  db.docs.get("private_voice_objects/"+id(3)).legacyUrl="private";
  const page=await run(db);
  assert.equal(page.items.length,4);
  assert.equal(page.items.every(x=>x.needsReview),true);
  assert.equal(page.items[0].evidenceMarkerPresent,true);
  assert.equal(page.items[1].draftPresent,true);
  assert.equal(page.items[3].state,"deleting");
});
test("pending appeals on voice metadata, draft, message and conversation require review",async()=>{
  for(const [state,path] of [
    ["sent","private_voice_objects/"+id(1)],
    ["sent",chat+"/messages/"+voice(1)],
    ["uploaded","private_voice_drafts/"+id(1)],
    ["sent",chat],
  ]) {
    for(const patch of [{appealPending:true},{appealStatus:" OPEN "}]) {
      const db=new Db();db.add(1,state);
      Object.assign(db.docs.get(path),patch);
      const page=await run(db);
      assert.equal(page.items[0].needsReview,true);
      assert.equal(page.completionVerified,false);
      assert.equal(page.erasureAllowed,false);
      assert.equal(JSON.stringify(page).includes("private-voice/"),false);
      assert.equal(db.docs.get(up).coins,500);
    }
  }
});
test("corrupt indexed owner rejected, even if query returned a foreign object",async()=>{
  const db=new Db();db.add(1);
  db.docs.get("private_voice_objects/"+id(1)).ownerUid=peer;
  db.runQuery=async()=>[{
    id:id(1),data:db.docs.get("private_voice_objects/"+id(1)),
  }];
  await assert.rejects(run(db),e=>
    e.code==="private_voice_inventory_owner_conflict");
});
test("cancelled or held account, wrong request and invalid actors block IO",async()=>{
  const modifications=[
    d=>d.docs.get(rp).status="cancelled",
    d=>d.docs.get(rp).requestId="other_request_123456789",
    d=>d.docs.get(cp).requestId="other_request_123456789",
    d=>d.docs.get(cp).legalHold=true,
    d=>d.docs.get(rp).appealPending=true,
    d=>d.docs.get(cp).appealStatus="UNDER_REVIEW",
    d=>d.docs.get(up).appealStatus="open",
    d=>d.docs.get(up).role="owner",
    d=>d.docs.get(up).authDeleted=true,
  ];
  for(const edit of modifications){
    const db=new Db();db.add(1);edit(db);
    await assert.rejects(run(db),e=>
      e.code==="private_voice_inventory_review_blocked");
    assert.equal(db.queries.length,0);
  }
  for(const patch of [
    {actor:{owner:false,uid:"not_owner_123"}},
    {uid:"../bad"},{requestId:"bad"},{cursor:"invalid"},
    {limit:0},{limit:MAX_PRIVATE_VOICE_INVENTORY_PAGE+1},
  ]){
    const db=new Db();db.get=async()=>{throw Error("unexpected_IO");};
    await assert.rejects(run(db,patch),e=>e.status===400||e.status===403);
    assert.equal(db.queries.length,0);
  }
});
test("source is read-only, with no R2/list, cron, Auth or delete",()=>{
  const source=readFileSync(
    "cloudflare-worker/src/account-deletion-private-voice-inventory.js",
    "utf8");
  assert.doesNotMatch(source,/writeDelete\(|db\.commit\(|USER_STORAGE\.|deleteAuthUser\(|setInterval\(/);
  assert.match(source,/completionVerified: false/);
  assert.match(source,/MAX_PRIVATE_VOICE_INVENTORY_PAGE = 5/);
});
