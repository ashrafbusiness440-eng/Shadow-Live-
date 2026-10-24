import assert from "node:assert/strict";
import {test,after} from "node:test";
import {randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {inspectAccountFinancialReviewPage as inspect}
  from "../../cloudflare-worker/src/account-deletion-financial-review-pages.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});

test("emulator: indexed Play purchase review preserves counterpart, balances and immutable ledger",async()=>{
  const suffix=randomUUID().replaceAll("-","").slice(0,18);
  const uid="finance_delete_"+suffix,other="finance_other_"+suffix;
  const requestId="finance_request_"+suffix;
  const req=store.doc("account_deletion_requests/"+uid);
  const cp=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const hashes=Array.from({length:5},(_,i)=>
    "purchase_hash_"+suffix+"_"+i);
  const purchases=hashes.map(hash=>
    store.doc("google_play_purchases/"+hash));
  const ledger=hashes.slice(0,4).map(hash=>
    store.doc("financial_ledger/play_"+hash));
  const otherPurchase=store.doc("google_play_purchases/other_"+suffix);
  const gift=store.doc("gift_transactions/gift_"+suffix);
  const refs=[req,cp,user,...purchases,...ledger,otherPurchase,gift];
  await Promise.all([
    req.set({uid,requestId,status:"review_ready"}),
    cp.set({uid,requestId,phase:"preflight_blocked",
      destructiveAllowed:false}),
    user.set({role:"user",coins:5000,diamonds:9}),
    ...purchases.map((ref,i)=>ref.set({
      uid,tokenHash:hashes[i],status:"credited",
      refundState:"none",disputeState:i===2?"pending":"none",
      orderId:"sensitive_order_"+i,coins:1000,
    })),
    ...ledger.map((ref,i)=>ref.set({
      userId:uid,sourceId:hashes[i],sourceType:"googlePlayPurchase",
      asset:"coins",delta:1000,closingBalance:(i+1)*1000,
    })),
    otherPurchase.set({uid:other,status:"credited",coins:1000}),
    gift.set({senderId:other,receiverId:uid,totalCoins:120,
      contextType:"room"}),
  ]);
  const opts={uid,requestId,actor:{owner:true,uid:"owner_control_123"}};
  try {
    const results=[];let cursor=null;
    for(let i=0;i<3;i++){
      const page=await inspect(db,{...opts,scope:"purchase",
        limit:2,cursor});
      results.push(...page.items);cursor=page.nextCursor;
      assert.equal(page.completionVerified,false);
      assert.equal(page.financialSettlementVerified,false);
      assert.equal(page.erasureAllowed,false);
      assert.equal(JSON.stringify(page).includes("sensitive_order"),false);
    }
    assert.equal(results.length,5);
    assert.equal(cursor,null);
    assert.equal(results.filter(x=>x.ledgerLinked).length,4);
    assert.equal(results.filter(x=>x.billingUnresolved).length,1);
    const gifts=await inspect(db,{...opts,scope:"gift_recipient"});
    assert.equal(gifts.checked,1);
    assert.equal(gifts.items[0].financialSettlementVerified,false);
    assert.equal((await user.get()).data().coins,5000);
    assert.equal((await gift.get()).data().totalCoins,120);
    assert.equal((await otherPurchase.get()).data().uid,other);
    assert.equal((await ledger[0].get()).data().delta,1000);
    await req.update({investigationHold:true});
    await assert.rejects(inspect(db,{...opts,scope:"purchase"}),
      e=>e.code==="financial_review_blocked");
  } finally {
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
