import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {
  inspectAccountSharedAssetsPage as inspect,
  MAX_SHARED_ASSET_INVENTORY_PAGE,
} from "../../cloudflare-worker/src/account-deletion-shared-asset-inventory-pages.js";

const uid="deleted_owner_123",requestId="deletion_assets_request_1234";
const actor={uid:"control_owner_999",owner:true};
const req="account_deletion_requests/"+uid;
const cp="account_deletion_erasure_checkpoints/"+uid;
const user="users/"+uid;
const roomId=i=>"owned_room_"+String(i).padStart(3,"0");
const agencyId="agency_deleted_owner_123";
class Db{
  constructor(){
    this.docs=new Map([
      [req,{uid,requestId,status:"review_ready"}],
      [cp,{uid,requestId,phase:"preflight_blocked",destructiveAllowed:false}],
      [user,{role:"user",coins:300,diamonds:4}],
    ]);this.queries=[];this.commits=0;this.gets=[];
  }
  async get(path){this.gets.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
  async runQuery(collection,options){
    this.queries.push({collection,options});
    const prefix=collection+"/";
    let rows=[...this.docs].filter(([p,d])=>
      p.startsWith(prefix)&&!p.slice(prefix.length).includes("/")&&
      d[options.filters[0].field]===options.filters[0].value)
      .map(([path,data])=>({id:path.slice(prefix.length),data}))
      .sort((a,b)=>a.id.localeCompare(b.id));
    if(options.startAfter.length){
      const cursor=options.startAfter[0].referencePath.slice(prefix.length);
      rows=rows.filter(row=>row.id>cursor);
    }
    return rows.slice(0,options.limit);
  }
  addRooms(n){
    for(let i=0;i<n;i++)this.docs.set("rooms/"+roomId(i),{
      ownerUid:uid,ownerId:uid,name:"secret room",
      agencyId:i===1?agencyId:"",participantCount:50,
    });
    this.docs.set("rooms/other_room_123",{
      ownerUid:"unrelated_owner_789",ownerId:"unrelated_owner_789",
      name:"other person's room"});
  }
  addAgency(){
    this.docs.set("agencies/"+agencyId,{
      agencyId,ownerUid:uid,name:"private agency",
      memberCount:13,hostCount:12,status:"active",
    });
    this.docs.set("agency_memberships/"+agencyId+"__"+uid,{
      agencyId,uid,role:"owner",status:"active",
    });
    this.docs.set("agency_user_memberships/"+uid,{
      agencyId,uid,role:"owner",status:"active",
    });
  }
}
const run=(db,extra={})=>inspect(db,{uid,requestId,actor,kind:"rooms_owner_uid",...extra});
test("eight owned room records are inventoried 5/3, no other rooms/content disclosed",async()=>{
  const db=new Db();db.addRooms(8);
  const first=await run(db);const next=await run(db,{cursor:first.nextCursor});
  assert.equal(first.items.length,5);assert.equal(next.items.length,3);
  assert.equal(first.hasMore,true);assert.equal(next.hasMore,false);
  assert.equal(next.nextCursor,null);
  assert.equal(first.items.every(x=>x.requiresOwnershipDecision),true);
  assert.equal(first.items.some(x=>x.linkedAgencyRequiresReview),true);
  assert.equal(JSON.stringify(first).includes("secret room"),false);
  assert.equal(JSON.stringify(next).includes("unrelated_owner_789"),false);
  assert.deepEqual(db.queries.map(q=>q.options.limit),[6,6]);
  assert.deepEqual(db.queries[0].options.filters,
    [{field:"ownerUid",op:"==",value:uid}]);
  assert.equal(first.ownershipTransferred,false);
  assert.equal(first.completionVerified,false);
  assert.equal(first.erasureAllowed,false);
  assert.equal(db.commits,0);
  assert.equal(db.docs.get(user).coins,300);
});
test("legacy ownerId path remains separately reviewed, never certifies completeness",async()=>{
  const db=new Db();db.docs.set("rooms/legacy_room_123",{
    ownerId:uid,roomName:"private",memberCount:4,
  });
  db.docs.set("rooms/mixed_room_123",{
    ownerId:uid,ownerUid:"other_owner_123",
  });
  const page=await run(db,{kind:"rooms_legacy_owner_id"});
  assert.equal(page.items.length,2);
  assert.equal(page.items.find(x=>x.id==="mixed_room_123").conflictingOwner,true);
  assert.equal(page.items.every(x=>x.needsReview),true);
  assert.equal(page.exhaustive,false);
});
test("agency owner and two membership records must agree, no settlement implied",async()=>{
  const db=new Db();db.addAgency();
  const good=await run(db,{kind:"agencies_owned"});
  assert.equal(good.items[0].membershipConsistent,true);
  assert.equal(good.items[0].requiresFinancialReview,true);
  assert.equal(good.ownershipTransferred,false);
  db.docs.get("agency_memberships/"+agencyId+"__"+uid).status="left";
  const bad=await run(db,{kind:"agencies_owned"});
  assert.equal(bad.items[0].membershipConsistent,false);
  db.docs.get("agency_memberships/"+agencyId+"__"+uid).status="active";
  db.docs.get("agencies/"+agencyId).legalHold=true;
  const held=await run(db,{kind:"agencies_owned"});
  assert.equal(held.items[0].held,true);
  assert.equal(held.items[0].needsReview,true);
});
test("stale request, legal hold, protected owner and missing checkpoint stop before query",async()=>{
  const changes=[
    d=>d.docs.get(req).status="cancelled",
    d=>d.docs.get(req).requestId="old_request_12345678",
    d=>d.docs.get(cp).requestId="old_request_12345678",
    d=>d.docs.get(cp).investigationHold=true,
    d=>d.docs.get(req).appealPending=true,
    d=>d.docs.get(req).appealStatus="Open",
    d=>d.docs.get(cp).appealStatus="under_review",
    d=>d.docs.get(user).appealPending=true,
    d=>d.docs.get(user).role="owner",
    d=>d.docs.get(user).authDeleted=true,
    d=>d.docs.delete(cp),
  ];
  for(const change of changes){
    const db=new Db();db.addRooms(2);change(db);
    await assert.rejects(run(db),e=>e.code==="shared_asset_inventory_review_blocked");
    assert.equal(db.queries.length,0);
  }
});
test("open appeal on shared room, agency or memberships remains unresolved",async()=>{
  const db=new Db();db.addRooms(2);db.addAgency();
  db.docs.get("rooms/"+roomId(0)).appealPending=true;
  db.docs.get("rooms/"+roomId(1)).appealStatus=" Under_Review ";
  const rooms=await run(db);
  assert.equal(rooms.items.length,2);
  assert.deepEqual(rooms.items.map(item=>item.held),[true,true]);
  assert.equal(rooms.erasureAllowed,false);
  for(const key of [
    "agencies/"+agencyId,
    "agency_memberships/"+agencyId+"__"+uid,
    "agency_user_memberships/"+uid,
  ]) {
    const data=db.docs.get(key);
    data.appealStatus="OPEN";
    const page=await run(db,{kind:"agencies_owned"});
    assert.equal(page.items.length,1);
    assert.equal(page.items[0].held,true);
    assert.equal(page.items[0].membershipConsistent,false);
    assert.equal(page.ownershipTransferred,false);
    delete data.appealStatus;
  }
  assert.equal(db.commits,0);
  assert.equal(db.docs.get(user).coins,300);
});
test("indexed foreign owner conflict and invalid query rows fail closed",async()=>{
  const db=new Db();db.addRooms(1);
  db.runQuery=async()=>[{
    id:roomId(0),data:{ownerUid:"other_person_123"},
  }];
  await assert.rejects(run(db),e=>e.code==="shared_asset_inventory_owner_conflict");
  db.runQuery=async()=>[{
    id:"../bad",data:{ownerUid:uid},
  }];
  await assert.rejects(run(db),e=>e.code==="shared_asset_inventory_invalid_page");
});
test("invalid inputs reject before any IO",async()=>{
  for(const patch of [
    {uid:"../invalid"},{requestId:"bad"},
    {kind:"all"},{cursor:"../bad"},{limit:0},
    {limit:MAX_SHARED_ASSET_INVENTORY_PAGE+1},
    {actor:{owner:false,uid:"ordinary_123"}},
  ]){
    const db=new Db();db.get=async()=>{throw Error("unexpected_IO");};
    await assert.rejects(run(db,patch),e=>e.status===400||e.status===403);
    assert.equal(db.queries.length,0);
  }
});
test("module has no auto transfer, mutation, notifications, cron or Auth",()=>{
  const s=readFileSync(
    "cloudflare-worker/src/account-deletion-shared-asset-inventory-pages.js","utf8");
  assert.doesNotMatch(s,/db\.commit\(|writeDelete\(|writeUpdate\(|deleteAuthUser\(|setInterval\(/);
  assert.match(s,/ownershipTransferred: false/);
  assert.match(s,/completionVerified: false/);
});
