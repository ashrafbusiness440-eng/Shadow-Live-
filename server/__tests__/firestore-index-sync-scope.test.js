import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Firestore index sync restricts matches to exact collection group", () => {
  const workflow = readFileSync(".github/workflows/deploy-firestore-rules.yml", "utf8");
  assert.ok(workflow.includes("const existing = (await listIndexes(parentUrl))"));
  assert.ok(workflow.includes("String(index?.name || '').startsWith(parent + '/indexes/')"));
  assert.ok(workflow.includes("const existingSignatures = new Set(existing.map(indexSignature))"));
});
test("index deployment workflow changes force an idempotent sync", () => {
  const workflow = readFileSync(".github/workflows/deploy-firestore-rules.yml", "utf8");
  assert.ok(workflow.includes("grep -Fxq '.github/workflows/deploy-firestore-rules.yml'"));
  assert.ok(workflow.includes('echo "run_index_sync=true"'));
});

test("global Store finance uses automatic date indexes and READY composite ledger/audit",()=>{
  const config=JSON.parse(readFileSync("firestore.indexes.json","utf8"));
  const workflow=readFileSync(".github/workflows/deploy-firestore-rules.yml","utf8");
  for(const [group,date] of [
    ["store_purchase_receipts","acquiredAtMs"],
    ["store_purchase_operations","createdAt"],
  ]){
    assert.equal(config.indexes.some(x=>x.collectionGroup===group&&
      x.fields.length===2&&x.fields[0].fieldPath===date&&
      x.fields[1].fieldPath==="__name__"),false);
    assert.match(workflow,/const requiredSingles=/);
    assert.ok(workflow.includes("['"+group+"','"+date+"']"));
  }
  for(const [group,fields] of [
    ["financial_ledger",["sourceType","createdAt","__name__"]],
    ["admin_audit_logs",["action","createdAt","__name__"]],
  ]){
    assert.ok(config.indexes.some(x=>x.collectionGroup===group&&
      x.fields.map(v=>v.fieldPath).join(",")===fields.join(",")));
    assert.ok(workflow.includes("['"+group+"',"));
  }
  assert.match(workflow,/store_global_single_index_disabled/);
  assert.match(workflow,/store_finance_index_not_ready/);
});
