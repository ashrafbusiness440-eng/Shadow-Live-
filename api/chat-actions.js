import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue,Timestamp} from "firebase-admin/firestore";

class ApiError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}

function parseServiceAccount(raw){
  const text=String(raw||"").trim();
  if(!text)throw new ApiError("server_not_configured",500);
  let sa=JSON.parse(text);
  if(typeof sa==="string")sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey)throw new ApiError("invalid_service_account_json",500);
  return {projectId,clientEmail,privateKey};
}

function init(){
  if(!getApps().length){
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({credential:cert(sa),projectId:sa.projectId});
  }
}

function cors(req,res){
  res.setHeader("access-control-allow-origin","*");
  res.setHeader("access-control-allow-methods","POST,OPTIONS");
  res.setHeader("access-control-allow-headers","Authorization, Content-Type");
  if(req.method==="OPTIONS"){res.status(204).end();return true;}
  return false;
}

const out=(res,status,body)=>res.status(status).json(body);
const text=(value)=>String(value??"").trim();
const validKey=(value)=>/^[A-Za-z0-9_-]{12,220}$/.test(value);
const bounded=(value,fallback,min,max)=>{
  const n=Number(value);
  return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;
};
const utcPeriodKeys=(date=new Date())=>{
  const day=date.toISOString().slice(0,10);
  const month=day.slice(0,7);
  const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  const weekday=d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()+4-weekday);
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const week=Math.ceil((((d-yearStart)/86400000)+1)/7);
  return {
    day,
    week:d.getUTCFullYear().toString()+"-W"+week.toString().padStart(2,"0"),
    month,
  };
};


function revenueTiers(economy){
  const fallback=[
    {id:"starter",nameAr:"Starter",minGiftCoins:0,hostShareBps:5500,agencyShareBps:500},
    {id:"bronze",nameAr:"Bronze",minGiftCoins:1000000,hostShareBps:5700,agencyShareBps:600},
    {id:"silver",nameAr:"Silver",minGiftCoins:5000000,hostShareBps:6000,agencyShareBps:800},
    {id:"gold",nameAr:"Gold",minGiftCoins:20000000,hostShareBps:6200,agencyShareBps:900},
    {id:"diamond",nameAr:"Diamond",minGiftCoins:50000000,hostShareBps:6300,agencyShareBps:1000},
  ];
  const raw=Array.isArray(economy?.tiers)&&economy.tiers.length?economy.tiers:fallback;
  return raw.map((item,index)=>({
    id:text(item?.id||("tier_"+String(index+1))),
    nameAr:text(item?.nameAr||item?.id||("Tier "+String(index+1))),
    minGiftCoins:Math.max(0,Number(item?.minGiftCoins||0)),
    hostShareBps:Math.max(0,Math.min(10000,Number(item?.hostShareBps??economy?.recipientShareBps??0))),
    agencyShareBps:Math.max(0,Math.min(10000,Number(item?.agencyShareBps||0))),
  })).sort((a,b)=>a.minGiftCoins-b.minGiftCoins);
}

function resolveRevenuePolicy(economy,receiverData,monthlyGrossCoins,agencyId,monthKey,activeHostCount=0){
  const tiers=revenueTiers(economy);
  let tier=tiers[0];
  for(const item of tiers){
    if(monthlyGrossCoins>=item.minGiftCoins)tier=item;
  }
  const activityMonth=text(receiverData?.giftHostActivityMonth);
  const qualifiedDays=activityMonth===monthKey
    ?Math.max(0,Number(receiverData?.giftHostQualifiedDays||0))
    :0;
  const requiredDays=Math.max(1,Math.min(31,Number(economy?.hostBonusQualifiedDays||9)));
  const configuredHostBonus=Math.max(0,Math.min(3000,Number(economy?.hostPerformanceBonusBps||0)));
  const hostBonusBps=qualifiedDays>=requiredDays?configuredHostBonus:0;
  const hostShareBps=Math.max(0,Math.min(10000,tier.hostShareBps+hostBonusBps));
  const requiredActiveHosts=Math.max(1,Math.min(100000,Number(economy?.agencyBonusActiveHosts||10)));
  const configuredAgencyBonus=Math.max(0,Math.min(3000,Number(economy?.agencyPerformanceBonusBps||0)));
  const agencyBonusBps=agencyId&&activeHostCount>=requiredActiveHosts?configuredAgencyBonus:0;
  const agencyShareBps=agencyId
    ?Math.max(0,Math.min(10000,tier.agencyShareBps+agencyBonusBps))
    :0;
  const platformShareBps=Math.max(0,10000-hostShareBps-agencyShareBps);
  return {
    tierId:tier.id,
    tierName:tier.nameAr,
    tierMinGiftCoins:tier.minGiftCoins,
    hostBaseShareBps:tier.hostShareBps,
    hostBonusBps,
    hostShareBps,
    agencyBaseShareBps:tier.agencyShareBps,
    agencyBonusBps,
    agencyShareBps,
    platformShareBps,
    qualifiedDays,
    requiredDays,
    activeHostCount,
    requiredActiveHosts,
  };
}

async function sendMessage(db,uid,body){
  const receiverId=text(body.receiverId);
  const conversationId=text(body.conversationId);
  const message=text(body.text);
  const key=text(body.idempotencyKey);
  if(!receiverId||receiverId===uid||!conversationId||conversationId.includes("/")||!message||message.length>2000||!validKey(key)){
    throw new ApiError("invalid_request",400);
  }

  const nowMs=Date.now();
  return db.runTransaction(async tx=>{
    const opRef=db.collection("message_operations").doc(key);
    const senderRef=db.collection("users").doc(uid);
    const receiverRef=db.collection("users").doc(receiverId);
    const conversationRef=db.collection("conversations").doc(conversationId);
    const outgoingFollowRef=db.collection("follows").doc(uid+"__"+receiverId);
    const incomingFollowRef=db.collection("follows").doc(receiverId+"__"+uid);
    const outgoingBlockRef=db.collection("user_blocks").doc(uid).collection("items").doc(receiverId);
    const incomingBlockRef=db.collection("user_blocks").doc(receiverId).collection("items").doc(uid);
    const senderLimitRef=db.collection("dm_limits").doc(conversationId+"__"+uid);
    const receiverLimitRef=db.collection("dm_limits").doc(conversationId+"__"+receiverId);
    const rateRef=db.collection("message_rate_limits").doc(uid);
    const configRef=db.collection("system_config").doc("messaging");

    const [op,sender,receiver,conversation,outgoingFollow,incomingFollow,outgoingBlock,incomingBlock,senderLimit,rate,config]=await Promise.all([
      tx.get(opRef),tx.get(senderRef),tx.get(receiverRef),tx.get(conversationRef),
      tx.get(outgoingFollowRef),tx.get(incomingFollowRef),tx.get(outgoingBlockRef),
      tx.get(incomingBlockRef),tx.get(senderLimitRef),tx.get(rateRef),tx.get(configRef),
    ]);

    if(op.exists)return {ok:true,code:"duplicate",...(op.data()?.result||{})};
    if(!sender.exists||!receiver.exists||!conversation.exists)throw new ApiError("not_found",404);

    const conversationData=conversation.data()||{};
    const participants=Array.isArray(conversationData.participants)?conversationData.participants:[];
    if(participants.length!==2||!participants.includes(uid)||!participants.includes(receiverId)){
      throw new ApiError("invalid_conversation",409);
    }
    if(outgoingBlock.exists||incomingBlock.exists)throw new ApiError("blocked",403);

    const cfg=config.data()||{};
    const windowSeconds=bounded(cfg.messageRateWindowSeconds,10,2,60);
    const maxMessages=bounded(cfg.messageRateMax,8,1,50);
    const rateData=rate.data()||{};
    const startedMs=rateData.windowStartedAt?.toMillis?.()||0;
    const sameWindow=startedMs>0&&(nowMs-startedMs)<windowSeconds*1000;
    const currentCount=sameWindow?Math.max(0,Number(rateData.count||0)):0;
    if(currentCount>=maxMessages)throw new ApiError("rate_limited",429);
    tx.set(rateRef,{
      windowStartedAt:Timestamp.fromMillis(sameWindow?startedMs:nowMs),
      count:currentCount+1,
      updatedAt:Timestamp.fromMillis(nowMs),
    },{merge:true});

    const mutual=outgoingFollow.exists&&incomingFollow.exists;
    const senderData=sender.data()||{};
    const assignedModerator=
      String(conversationData.customerServiceModeratorUid||"")===uid &&
      String(senderData.role||"")==="moderator";
    if(!mutual&&!assignedModerator&&!outgoingFollow.exists)throw new ApiError("follow_required",403);

    const unanswered=Math.max(0,Number(senderLimit.data()?.unansweredCount||0));
    if(!mutual&&!assignedModerator&&unanswered>=3)throw new ApiError("message_limit_reached",429);

    const now=FieldValue.serverTimestamp();
    const counts={...(conversationData.unreadCounts||{})};
    counts[uid]=0;
    counts[receiverId]=Number(counts[receiverId]||0)+1;
    const messageRef=conversationRef.collection("messages").doc();

    tx.update(conversationRef,{
      lastMessage:message,
      lastSenderId:uid,
      updatedAt:now,
      unreadCounts:counts,
    });
    tx.create(messageRef,{
      senderId:uid,
      receiverId,
      text:message,
      type:"text",
      createdAt:now,
    });

    if(mutual){
      tx.set(senderLimitRef,{unansweredCount:0,updatedAt:now},{merge:true});
      tx.set(receiverLimitRef,{unansweredCount:0,updatedAt:now},{merge:true});
    }else if(assignedModerator){
      tx.set(receiverLimitRef,{unansweredCount:0,updatedAt:now},{merge:true});
    }else{
      tx.set(senderLimitRef,{unansweredCount:unanswered+1,updatedAt:now},{merge:true});
      tx.set(receiverLimitRef,{unansweredCount:0,updatedAt:now},{merge:true});
    }

    const resultData={
      messageId:messageRef.id,
      mutual,
      assignedCustomerServiceModerator:assignedModerator,
      remaining:mutual||assignedModerator?null:Math.max(0,2-unanswered),
    };
    tx.create(opRef,{
      senderId:uid,
      receiverId,
      conversationId,
      action:"sendMessage",
      status:"completed",
      result:resultData,
      createdAt:now,
    });
    return {ok:true,code:"ok",...resultData};
  });
}

async function sendGift(db,uid,body){
  const receiverId=text(body.receiverId);
  const giftId=text(body.giftId);
  const conversationId=text(body.conversationId);
  const key=text(body.idempotencyKey);
  const quantity=Number(body.quantity||1);
  if(!receiverId||receiverId===uid||!giftId||!conversationId||![1,7,77,777].includes(quantity)||!validKey(key)){
    throw new ApiError("invalid_request",400);
  }

  return db.runTransaction(async tx=>{
    const opRef=db.collection("gift_operations").doc(key);
    const senderRef=db.collection("users").doc(uid);
    const receiverRef=db.collection("users").doc(receiverId);
    const catalogRef=db.collection("system_config").doc("gift_catalog");
    const economyRef=db.collection("system_config").doc("gift_economy");
    const conversationRef=db.collection("conversations").doc(conversationId);
    const periods=utcPeriodKeys();
    const outgoingBlockRef=db.collection("user_blocks").doc(uid).collection("items").doc(receiverId);
    const incomingBlockRef=db.collection("user_blocks").doc(receiverId).collection("items").doc(uid);
    const [op,sender,receiver,catalog,economy,conversation,outgoingBlock,incomingBlock]=await Promise.all([
      tx.get(opRef),tx.get(senderRef),tx.get(receiverRef),tx.get(catalogRef),tx.get(economyRef),
      tx.get(conversationRef),tx.get(outgoingBlockRef),tx.get(incomingBlockRef),
    ]);

    if(op.exists)return {ok:true,code:"duplicate",...(op.data()?.result||{})};
    if(!sender.exists||!receiver.exists||!conversation.exists)throw new ApiError("not_found",404);
    const conversationData=conversation.data()||{};
    const participants=Array.isArray(conversationData.participants)?conversationData.participants:[];
    if(participants.length!==2||!participants.includes(uid)||!participants.includes(receiverId)){
      throw new ApiError("invalid_conversation",409);
    }
    if(outgoingBlock.exists||incomingBlock.exists)throw new ApiError("blocked",403);

    const fallback=[
      {id:"rose",nameAr:"وردة",priceCoins:100,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"coffee",nameAr:"قهوة",priceCoins:300,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"heart",nameAr:"قلب",priceCoins:500,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"chocolate",nameAr:"شوكولا",priceCoins:1000,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"crown",nameAr:"تاج",priceCoins:2500,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"ring",nameAr:"خاتم ألماس",priceCoins:5000,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"sports_car",nameAr:"سيارة رياضية",priceCoins:10000,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"yacht",nameAr:"يخت فاخر",priceCoins:25000,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"private_jet",nameAr:"طائرة خاصة",priceCoins:50000,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"castle",nameAr:"قصر ملكي",priceCoins:100000,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"golden_dragon",nameAr:"التنين الذهبي",priceCoins:250000,enabled:true,assetKey:"gifts.placeholder.default"},
      {id:"galaxy",nameAr:"مجرة شادو",priceCoins:500000,enabled:true,assetKey:"gifts.placeholder.default"},
    ];
    const rawCatalog=catalog.exists&&Array.isArray(catalog.data()?.gifts)?catalog.data().gifts:fallback;
    const giftData=rawCatalog.find(item=>String(item?.id||"")===giftId);
    if(!giftData)throw new ApiError("not_found",404);
    if(giftData.enabled===false)throw new ApiError("gift_inactive",409);
    const unitCoins=Number(giftData.priceCoins||0);
    if(!Number.isSafeInteger(unitCoins)||unitCoins<=0)throw new ApiError("invalid_gift_price",409);

    const totalCost=unitCoins*quantity;
    if(!Number.isSafeInteger(totalCost)||totalCost<=0)throw new ApiError("invalid_gift_price",409);
    const senderData=sender.data()||{};
    const receiverData=receiver.data()||{};
    const before=Number(senderData.coins||0);
    if(before<totalCost)throw new ApiError("insufficient_balance",409);

    const economyData=economy.exists?(economy.data()||{}):{};
    const agencyId=text(receiverData.agencyId||"");
    const agencyMonthRef=agencyId
      ?db.collection("agency_support_stats").doc(agencyId).collection("monthly").doc(periods.month)
      :null;
    const agencyMonthSnap=agencyMonthRef?await tx.get(agencyMonthRef):null;
    const activeHostIds=agencyMonthSnap&&Array.isArray(agencyMonthSnap.data()?.activeHostIds)
      ?agencyMonthSnap.data().activeHostIds
      :[];
    const activeHostCount=activeHostIds.length;
    const previousMonthCoins=
      text(receiverData.giftRevenueMonth)===periods.month
        ?Math.max(0,Number(receiverData.giftRevenueMonthCoins||0))
        :0;
    const monthlyGrossCoins=previousMonthCoins+totalCost;
    const revenue=resolveRevenuePolicy(
      economyData,receiverData,monthlyGrossCoins,agencyId,periods.month,activeHostCount
    );
    const policyEnabled=economyData.policyMode==="tiered_host_agency"
      ?economyData.enabled!==false
      :true;
    const earningsEnabled=policyEnabled&&revenue.hostShareBps>0;
    const recipientShareBps=earningsEnabled?revenue.hostShareBps:0;
    const recipientShareCoins=earningsEnabled
      ?Math.floor((totalCost*recipientShareBps)/10000)
      :0;
    const agencyShareCoins=policyEnabled&&agencyId
      ?Math.floor((totalCost*revenue.agencyShareBps)/10000)
      :0;
    const platformShareCoins=policyEnabled
      ?Math.max(0,totalCost-recipientShareCoins-agencyShareCoins)
      :totalCost;
    const previousPending=Math.max(0,Number(receiverData.pendingGiftEarningCoins||0));
    const accumulated=previousPending+recipientShareCoins;
    const diamondsEarned=earningsEnabled?Math.floor(accumulated/10000):0;
    const pendingGiftEarningCoins=earningsEnabled?accumulated%10000:previousPending;
    const openingDiamonds=Math.max(0,Number(receiverData.diamonds||0));
    const closingDiamonds=openingDiamonds+diamondsEarned;

    const after=before-totalCost;
    const now=FieldValue.serverTimestamp();
    const giftName=String(giftData.nameAr||"هدية");
    const imageUrl=String(giftData.imageUrl||"");
    const assetKey=String(giftData.assetKey||"gifts.placeholder.default");
    const messageRef=conversationRef.collection("messages").doc();
    const transactionRef=db.collection("gift_transactions").doc(key);
    const ledgerRef=db.collection("financial_ledger").doc("gift_"+key);
    const earningsLedgerRef=db.collection("financial_ledger").doc("gift_earnings_"+key);
    const userDailyRef=db.collection("gift_user_stats").doc(receiverId).collection("daily").doc(periods.day);
    const userWeeklyRef=db.collection("gift_user_stats").doc(receiverId).collection("weekly").doc(periods.week);
    const userMonthlyRef=db.collection("gift_user_stats").doc(receiverId).collection("monthly").doc(periods.month);
    const showcaseRef=db.collection("public_gift_showcases").doc(receiverId).collection("items").doc(giftId);
    const counts={...(conversationData.unreadCounts||{})};
    counts[uid]=0;
    counts[receiverId]=Number(counts[receiverId]||0)+1;

    tx.update(senderRef,{coins:after,totalGiftsSent:FieldValue.increment(quantity)});
    tx.update(receiverRef,{
      totalGiftsReceived:FieldValue.increment(quantity),
      totalValueReceived:FieldValue.increment(totalCost),
      giftSupportReceivedCoins:FieldValue.increment(totalCost),
      giftRevenueMonth:periods.month,
      giftRevenueMonthCoins:monthlyGrossCoins,
      currentGiftRevenueTier:revenue.tierId,
      ...(earningsEnabled?{
        diamonds:closingDiamonds,
        pendingGiftEarningCoins,
        giftEarningCoinsLifetime:FieldValue.increment(recipientShareCoins),
        giftDiamondsLifetime:FieldValue.increment(diamondsEarned),
      }:{})
    });
    const receiverStats={
      receivedCoins:FieldValue.increment(totalCost),
      giftCount:FieldValue.increment(quantity),
      earningCoins:FieldValue.increment(recipientShareCoins),
      diamondsEarned:FieldValue.increment(diamondsEarned),
      updatedAt:now,
    };
    tx.set(userDailyRef,receiverStats,{merge:true});
    tx.set(userWeeklyRef,receiverStats,{merge:true});
    tx.set(userMonthlyRef,receiverStats,{merge:true});
    if(agencyId){
      const agencyRootRef=db.collection("agency_support_stats").doc(agencyId);
      const agencyStats={
        supportCoins:FieldValue.increment(totalCost),
        giftCount:FieldValue.increment(quantity),
        hostEarningCoins:FieldValue.increment(recipientShareCoins),
        agencyEarningCoins:FieldValue.increment(agencyShareCoins),
        platformShareCoins:FieldValue.increment(platformShareCoins),
        activeHostCount,
        updatedAt:now,
      };
      tx.set(agencyRootRef.collection("daily").doc(periods.day),agencyStats,{merge:true});
      tx.set(agencyRootRef.collection("weekly").doc(periods.week),agencyStats,{merge:true});
      tx.set(agencyRootRef.collection("monthly").doc(periods.month),agencyStats,{merge:true});
    }
    if(earningsEnabled&&diamondsEarned>0){
      tx.create(earningsLedgerRef,{
        userId:receiverId,asset:"diamonds",delta:diamondsEarned,
        openingBalance:openingDiamonds,closingBalance:closingDiamonds,
        reason:"gift_earnings",sourceType:"gift",sourceId:key,
        actorUid:uid,counterpartyUid:uid,idempotencyKey:key+"_earnings",createdAt:now
      });
    }
    tx.update(conversationRef,{lastMessage:"🎁 "+giftName+" ×"+quantity,lastSenderId:uid,updatedAt:now,unreadCounts:counts});
    tx.create(messageRef,{senderId:uid,receiverId,type:"gift",giftId,giftName,quantity,unitCoins,totalCost,imageUrl,assetKey,createdAt:now});
    tx.create(transactionRef,{
      senderId:uid,receiverId,contextType:"chat",conversationId,giftId,giftName,quantity,unitCoins,totalCost,
      assetKey,
      policyMode:text(economyData.policyMode||"legacy"),
      revenueTierId:revenue.tierId,
      revenueTierName:revenue.tierName,
      revenueTierMinGiftCoins:revenue.tierMinGiftCoins,
      monthlyGrossCoins,
      recipientShareBps,
      recipientShareCoins,
      hostBaseShareBps:revenue.hostBaseShareBps,
      hostBonusBps:revenue.hostBonusBps,
      agencyBaseShareBps:revenue.agencyBaseShareBps,
      agencyBonusBps:revenue.agencyBonusBps,
      agencyShareBps:revenue.agencyShareBps,
      agencyShareCoins,
      agencyActiveHostCount:revenue.activeHostCount,
      agencyRequiredActiveHosts:revenue.requiredActiveHosts,
      platformShareBps:revenue.platformShareBps,
      platformShareCoins,
      qualifiedDays:revenue.qualifiedDays,
      requiredQualifiedDays:revenue.requiredDays,
      diamondsEarned,pendingGiftEarningCoins,
      earningsStatus:earningsEnabled?"applied":"pending_policy",periods,agencyId:agencyId||null,createdAt:now
    });
    tx.create(ledgerRef,{userId:uid,asset:"coins",delta:-totalCost,openingBalance:before,closingBalance:after,reason:"gift_send",sourceType:"gift",sourceId:key,actorUid:uid,idempotencyKey:key,createdAt:now});
    tx.set(showcaseRef,{giftId,name:giftName,imageUrl,assetKey,count:FieldValue.increment(quantity),updatedAt:now},{merge:true});

    const resultData={
      giftId,giftName,quantity,totalCost,messageId:messageRef.id,balance:after,
      revenueTierId:revenue.tierId,
      recipientShareCoins,agencyShareCoins,platformShareCoins,
      diamondsEarned,earningsApplied:earningsEnabled
    };
    tx.create(opRef,{senderId:uid,receiverId,action:"sendGift",status:"completed",result:resultData,createdAt:now});
    return {ok:true,code:"ok",...resultData};
  });
}

async function sendRoomInvite(db,uid,body){
  const receiverId=text(body.receiverId);
  const conversationId=text(body.conversationId);
  const roomId=text(body.roomId);
  const key=text(body.idempotencyKey);
  if(!receiverId||receiverId===uid||!conversationId||conversationId.includes("/")||!roomId||roomId.includes("/")||!validKey(key)){
    throw new ApiError("invalid_request",400);
  }

  return db.runTransaction(async tx=>{
    const opRef=db.collection("message_operations").doc(key);
    const receiverRef=db.collection("users").doc(receiverId);
    const conversationRef=db.collection("conversations").doc(conversationId);
    const roomRef=db.collection("rooms").doc(roomId);
    const senderPresenceRef=db.collection("room_presence").doc(roomId).collection("users").doc(uid);
    const inviteRateRef=db.collection("room_invite_rate_limits").doc(roomId+"__"+uid+"__"+receiverId);
    const outgoingFollowRef=db.collection("follows").doc(uid+"__"+receiverId);
    const incomingFollowRef=db.collection("follows").doc(receiverId+"__"+uid);
    const outgoingBlockRef=db.collection("user_blocks").doc(uid).collection("items").doc(receiverId);
    const incomingBlockRef=db.collection("user_blocks").doc(receiverId).collection("items").doc(uid);

    const [op,receiver,conversation,room,senderPresence,inviteRate,outgoingFollow,incomingFollow,outgoingBlock,incomingBlock]=await Promise.all([
      tx.get(opRef),tx.get(receiverRef),tx.get(conversationRef),tx.get(roomRef),
      tx.get(senderPresenceRef),tx.get(inviteRateRef),
      tx.get(outgoingFollowRef),tx.get(incomingFollowRef),tx.get(outgoingBlockRef),tx.get(incomingBlockRef),
    ]);

    if(op.exists)return {ok:true,code:"duplicate",...(op.data()?.result||{})};
    if(!receiver.exists||!room.exists)throw new ApiError("not_found",404);

    if(outgoingBlock.exists||incomingBlock.exists)throw new ApiError("blocked",403);
    if(!outgoingFollow.exists||!incomingFollow.exists)throw new ApiError("mutual_follow_required",403);

    const conversationData=conversation.exists?(conversation.data()||{}):{};
    if(conversation.exists){
      const participants=Array.isArray(conversationData.participants)?conversationData.participants:[];
      if(participants.length!==2||!participants.includes(uid)||!participants.includes(receiverId)){
        throw new ApiError("invalid_conversation",409);
      }
    }

    const roomData=room.data()||{};
    if(roomData.isActive===false)throw new ApiError("room_unavailable",409);

    const roomOwnerUid=String(roomData.ownerUid||roomData.ownerId||roomData.hostId||"");
    const presenceLastSeen=Number(senderPresence.data()?.lastSeenAtMs||0);
    const senderPresent=senderPresence.exists&&(Date.now()-presenceLastSeen)<=90000;
    if(roomOwnerUid!==uid&&!senderPresent)throw new ApiError("not_in_room",403);

    const nowMs=Date.now();
    const lastInviteMs=inviteRate.data()?.lastSentAt?.toMillis?.()||0;
    if(lastInviteMs>0&&nowMs-lastInviteMs<30000)throw new ApiError("rate_limited",429);

    const roomName=String(roomData.name||roomData.title||"غرفة صوتية");
    const roomPublicId=String(roomData.publicId||"");
    const now=FieldValue.serverTimestamp();
    const counts={...(conversationData.unreadCounts||{})};
    counts[uid]=0;
    counts[receiverId]=Number(counts[receiverId]||0)+1;
    const messageRef=conversationRef.collection("messages").doc();
    const roomInviteAccessRef=db
      .collection("room_invites")
      .doc(roomId)
      .collection("users")
      .doc(receiverId);

    if(conversation.exists){
      tx.update(conversationRef,{
        lastMessage:"🔊 دعوة إلى "+roomName,
        lastSenderId:uid,
        updatedAt:now,
        unreadCounts:counts,
      });
    }else{
      tx.create(conversationRef,{
        participants:[uid,receiverId].sort(),
        createdAt:now,
        updatedAt:now,
        lastMessage:"🔊 دعوة إلى "+roomName,
        lastSenderId:uid,
        unreadCounts:counts,
      });
    }
    tx.create(messageRef,{
      senderId:uid,
      receiverId,
      type:"room_invite",
      roomId,
      roomName,
      roomPublicId,
      roomOwnerUid:String(roomData.ownerUid||roomData.ownerId||roomData.hostId||""),
      createdAt:now,
    });
    tx.set(roomInviteAccessRef,{
      roomId,
      userId:receiverId,
      invitedBy:uid,
      createdAt:now,
      expiresAt:Timestamp.fromMillis(Date.now()+12*60*60*1000),
    },{merge:true});
    tx.set(inviteRateRef,{
      roomId,
      senderUid:uid,
      receiverUid:receiverId,
      lastSentAt:Timestamp.fromMillis(nowMs),
      updatedAt:now,
    },{merge:true});

    const resultData={messageId:messageRef.id,roomId,roomName};
    tx.create(opRef,{
      senderId:uid,
      receiverId,
      conversationId,
      action:"sendRoomInvite",
      status:"completed",
      result:resultData,
      createdAt:now,
    });
    return {ok:true,code:"ok",...resultData};
  });
}

async function setBlock(db,uid,body){
  const targetUserId=text(body.targetUserId);
  const blocked=body.blocked===true;
  if(!targetUserId||targetUserId===uid)throw new ApiError("invalid_request",400);

  return db.runTransaction(async tx=>{
    const targetRef=db.collection("users").doc(targetUserId);
    const blockRef=db.collection("user_blocks").doc(uid).collection("items").doc(targetUserId);
    const outgoingFollowRef=db.collection("follows").doc(uid+"__"+targetUserId);
    const incomingFollowRef=db.collection("follows").doc(targetUserId+"__"+uid);
    const [target,currentBlock,outgoingFollow,incomingFollow]=await Promise.all([
      tx.get(targetRef),tx.get(blockRef),tx.get(outgoingFollowRef),tx.get(incomingFollowRef),
    ]);
    if(!target.exists)throw new ApiError("not_found",404);

    if(blocked){
      tx.set(blockRef,{
        blockerUid:uid,
        blockedUid:targetUserId,
        createdAt:currentBlock.exists?(currentBlock.data()?.createdAt||FieldValue.serverTimestamp()):FieldValue.serverTimestamp(),
        updatedAt:FieldValue.serverTimestamp(),
      },{merge:true});
      if(outgoingFollow.exists)tx.delete(outgoingFollowRef);
      if(incomingFollow.exists)tx.delete(incomingFollowRef);
    }else if(currentBlock.exists){
      tx.delete(blockRef);
    }
    return {ok:true,blocked};
  });
}

async function reportUser(db,uid,body){
  const targetUserId=text(body.targetUserId);
  const conversationId=text(body.conversationId);
  const reason=text(body.reason);
  const details=text(body.details);
  const key=text(body.idempotencyKey);
  const allowedReasons=new Set(["spam","harassment","inappropriate_content","scam","other"]);
  if(!targetUserId||targetUserId===uid||!conversationId||conversationId.includes("/")||!allowedReasons.has(reason)||details.length>500||!validKey(key)){
    throw new ApiError("invalid_request",400);
  }

  const nowMs=Date.now();
  return db.runTransaction(async tx=>{
    const opRef=db.collection("report_operations").doc(key);
    const targetRef=db.collection("users").doc(targetUserId);
    const conversationRef=db.collection("conversations").doc(conversationId);
    const rateRef=db.collection("report_rate_limits").doc(uid);
    const configRef=db.collection("system_config").doc("messaging");
    const reportRef=db.collection("reports").doc();

    const [op,target,conversation,rate,config]=await Promise.all([
      tx.get(opRef),tx.get(targetRef),tx.get(conversationRef),tx.get(rateRef),tx.get(configRef),
    ]);
    if(op.exists)return {ok:true,code:"duplicate",...(op.data()?.result||{})};
    if(!target.exists||!conversation.exists)throw new ApiError("not_found",404);

    const participants=Array.isArray(conversation.data()?.participants)?conversation.data().participants:[];
    if(participants.length!==2||!participants.includes(uid)||!participants.includes(targetUserId)){
      throw new ApiError("invalid_conversation",409);
    }

    const cfg=config.data()||{};
    const windowMinutes=bounded(cfg.reportRateWindowMinutes,60,5,1440);
    const maxReports=bounded(cfg.reportRateMax,5,1,20);
    const rateData=rate.data()||{};
    const startedMs=rateData.windowStartedAt?.toMillis?.()||0;
    const sameWindow=startedMs>0&&(nowMs-startedMs)<windowMinutes*60*1000;
    const currentCount=sameWindow?Math.max(0,Number(rateData.count||0)):0;
    if(currentCount>=maxReports)throw new ApiError("rate_limited",429);

    tx.set(rateRef,{
      windowStartedAt:Timestamp.fromMillis(sameWindow?startedMs:nowMs),
      count:currentCount+1,
      updatedAt:Timestamp.fromMillis(nowMs),
    },{merge:true});

    const now=FieldValue.serverTimestamp();
    tx.create(reportRef,{
      type:"user",
      reporterId:uid,
      targetUserId,
      conversationId,
      reason,
      details,
      source:"private_chat",
      status:"open",
      createdAt:now,
      updatedAt:now,
    });
    const resultData={reportId:reportRef.id};
    tx.create(opRef,{
      reporterId:uid,
      targetUserId,
      action:"reportUser",
      status:"completed",
      result:resultData,
      createdAt:now,
    });
    return {ok:true,code:"ok",...resultData};
  });
}

async function setFollow(db,uid,body){
  const targetUserId=text(body.targetUserId);
  const following=body.following===true;
  if(!targetUserId||targetUserId===uid)throw new ApiError("invalid_request",400);

  return db.runTransaction(async tx=>{
    const targetRef=db.collection("users").doc(targetUserId);
    const relationRef=db.collection("follows").doc(uid+"__"+targetUserId);
    const outgoingBlockRef=db.collection("user_blocks").doc(uid).collection("items").doc(targetUserId);
    const incomingBlockRef=db.collection("user_blocks").doc(targetUserId).collection("items").doc(uid);
    const [target,relation,outgoingBlock,incomingBlock]=await Promise.all([
      tx.get(targetRef),tx.get(relationRef),tx.get(outgoingBlockRef),tx.get(incomingBlockRef),
    ]);
    if(!target.exists)throw new ApiError("not_found",404);
    if(following&&(outgoingBlock.exists||incomingBlock.exists))throw new ApiError("blocked",403);

    if(following&&!relation.exists){
      tx.create(relationRef,{
        followerUid:uid,
        followingUid:targetUserId,
        createdAt:FieldValue.serverTimestamp(),
      });
    }else if(!following&&relation.exists){
      tx.delete(relationRef);
    }
    return {ok:true,following};
  });
}

async function safetyStatus(db,uid,body){
  const targetUserId=text(body.targetUserId);
  if(!targetUserId||targetUserId===uid)throw new ApiError("invalid_request",400);
  const [target,outgoingBlock,incomingBlock]=await Promise.all([
    db.collection("users").doc(targetUserId).get(),
    db.collection("user_blocks").doc(uid).collection("items").doc(targetUserId).get(),
    db.collection("user_blocks").doc(targetUserId).collection("items").doc(uid).get(),
  ]);
  if(!target.exists)throw new ApiError("not_found",404);
  return {
    ok:true,
    blockedByMe:outgoingBlock.exists,
    blockedByOther:incomingBlock.exists,
    blocked:outgoingBlock.exists||incomingBlock.exists,
  };
}

export default async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    init();
    const auth=req.headers.authorization||"";
    if(!auth.startsWith("Bearer "))throw new ApiError("unauthorized",401);
    const decoded=await getAuth().verifyIdToken(auth.slice(7));
    const body=req.body||{};
    const action=text(body.action);
    const db=getFirestore();

    let result;
    switch(action){
      case "sendMessage": result=await sendMessage(db,decoded.uid,body); break;
      case "sendGift": result=await sendGift(db,decoded.uid,body); break;
      case "sendRoomInvite": result=await sendRoomInvite(db,decoded.uid,body); break;
      case "setBlock": result=await setBlock(db,decoded.uid,body); break;
      case "reportUser": result=await reportUser(db,decoded.uid,body); break;
      case "setFollow": result=await setFollow(db,decoded.uid,body); break;
      case "safetyStatus": result=await safetyStatus(db,decoded.uid,body); break;
      default: throw new ApiError("invalid_action",400);
    }
    return out(res,200,result);
  }catch(e){
    if(e instanceof ApiError)return out(res,e.status,{ok:false,code:e.code});
    const code=e?.message==="auth/id-token-expired"?"unauthorized":"server_failed";
    const status=code==="unauthorized"?401:500;
    return out(res,status,{ok:false,code});
  }
}
