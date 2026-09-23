import {onSchedule} from "firebase-functions/v2/scheduler";
import {
  DocumentReference,
  FieldValue,
  Firestore,
  getFirestore,
} from "firebase-admin/firestore";

const clean=(value:unknown)=>String(value??"").trim();

export async function settleGameOperationRef(
  db:Firestore,
  operationRef:DocumentReference,
  nowMs:number,
):Promise<boolean>{
  return db.runTransaction(async tx=>{
    const operationSnap=await tx.get(operationRef);
    if(!operationSnap.exists)return false;
    const operation=operationSnap.data()??{};
    if(clean(operation.status)!=="pending")return false;
    if(Number(operation.closesAtMs??0)>nowMs)return false;

    const uid=clean(operation.userId);
    const operationId=clean(operation.operationId||operationRef.id);
    const roundId=clean(operation.roundId);
    const gameId=clean(operation.gameId);
    if(!uid||!operationId||!roundId||!gameId){
      throw new Error("invalid_game_operation");
    }

    const userRef=db.collection("users").doc(uid);
    const userSnap=await tx.get(userRef);
    if(!userSnap.exists)throw new Error("game_user_not_found");

    const payout=Number(operation.payoutCoins??0);
    const before=Number(userSnap.data()?.coins??userSnap.data()?.balance??0);
    if(!Number.isSafeInteger(payout)||payout<0||
       !Number.isSafeInteger(before)||before<0){
      throw new Error("invalid_game_wallet_state");
    }
    const after=before+payout;
    if(!Number.isSafeInteger(after))throw new Error("invalid_game_wallet_state");

    const now=FieldValue.serverTimestamp();
    const roundRef=db.collection("game_rounds").doc(roundId);
    const creditLedgerRef=db.collection("financial_ledger")
      .doc("game_credit__"+operationId);
    const historyRef=db.collection("game_user_history")
      .doc(uid).collection("items").doc(operationId);

    if(payout>0){
      tx.update(userRef,{
        coins:after,
        walletUpdatedAt:now,
      });
      tx.create(creditLedgerRef,{
        userId:uid,
        operationId,
        gameId,
        roundId,
        sourceType:"game",
        type:"game_payout_credit",
        delta:payout,
        openingBalance:before,
        closingBalance:after,
        idempotencyKey:clean(operation.idempotencyKey),
        createdAt:now,
      });
    }

    tx.update(operationRef,{
      status:"settled",
      balanceAfter:after,
      settledAt:now,
      updatedAt:now,
      settlementWorker:"firebase_schedule",
    });
    tx.set(roundRef,{
      status:"settled",
      totalPayoutCoins:FieldValue.increment(payout),
      settledOperationCount:FieldValue.increment(1),
      updatedAt:now,
    },{merge:true});
    tx.set(historyRef,{
      operationId,
      gameId,
      mode:clean(operation.mode),
      roomId:clean(operation.roomId),
      roundId,
      roundNumber:Number(operation.roundNumber??0),
      dayKey:clean(operation.dayKey),
      totalStakeCoins:Number(operation.totalStakeCoins??0),
      payoutCoins:payout,
      outcomeId:clean(operation.outcomeId),
      reels:Array.isArray(operation.reels)?operation.reels:[],
      settledAt:now,
    });
    return true;
  });
}

export async function settleDueGameOperations(
  db:Firestore,
  nowMs=Date.now(),
  limit=100,
):Promise<{checked:number;settled:number;failed:number}>{
  const snapshot=await db.collection("game_operations")
    .where("status","==","pending")
    .limit(Math.max(1,Math.min(200,limit)))
    .get();

  let settled=0;
  let failed=0;
  for(const doc of snapshot.docs){
    if(Number(doc.data()?.closesAtMs??0)>nowMs)continue;
    try{
      if(await settleGameOperationRef(db,doc.ref,nowMs))settled++;
    }catch(error){
      failed++;
      console.error("game settlement failed",doc.id,error);
    }
  }
  return {checked:snapshot.size,settled,failed};
}

export const gameSettlementWorker=onSchedule({
  schedule:"* * * * *",
  timeZone:"UTC",
  region:"us-central1",
  timeoutSeconds:60,
},async()=>{
  const result=await settleDueGameOperations(getFirestore());
  console.log("game settlement worker",result);
});
