import assert from "node:assert/strict";
import test from "node:test";
import {economyPermissions} from "../economy-permissions.js";

test("ordinary users cannot access economy controls or settlement",()=>{
  const p=economyPermissions({role:"user",adminEnabled:false,capabilities:[]});
  assert.equal(p.canEconomy,false);
  assert.equal(p.canManageSettlements,false);
  assert.equal(p.canSettle,false);
});

test("manageEconomy alone does not authorize settlement",()=>{
  const p=economyPermissions({
    role:"admin",adminEnabled:true,capabilities:["manageEconomy"],
  });
  assert.equal(p.canEconomy,true);
  assert.equal(p.canManageSettlements,false);
  assert.equal(p.canSettle,false);
});

test("manageSettlements alone is insufficient because economy access is also required",()=>{
  const p=economyPermissions({
    role:"admin",adminEnabled:true,capabilities:["manageSettlements"],
  });
  assert.equal(p.canEconomy,false);
  assert.equal(p.canManageSettlements,true);
  assert.equal(p.canSettle,false);
});

test("admin needs both economy and settlement capabilities",()=>{
  const p=economyPermissions({
    role:"admin",
    adminEnabled:true,
    capabilities:["manageEconomy","manageSettlements"],
  });
  assert.equal(p.canSettle,true);
});

test("owner retains settlement authority",()=>{
  const p=economyPermissions({role:"owner"});
  assert.equal(p.canEconomy,true);
  assert.equal(p.canManageSettlements,true);
  assert.equal(p.canSettle,true);
});
