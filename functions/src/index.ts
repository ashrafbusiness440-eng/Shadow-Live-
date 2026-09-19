import {onRequest} from "firebase-functions/v2/https";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";

initializeApp();
const db=getFirestore();

const sensitive=new Set(["adjustBalance","approveWithdrawal","paySettlement","changeRole","emergencyLock"]);

async function actorFrom(req:any){
 const header=String(req.headers.authorization??"");
 if(!header.startsWith("Bearer "))throw new Error("unauthenticated");
 const decoded=await getAuth().verifyIdToken(header.slice(7),true);
 const snap=await db.collection("users").doc(decoded.uid).get();
 if(!snap.exists)throw new Error("denied");
 const data=snap.data()??{};
 return {uid:decoded.uid,role:String(data.role??"user"),enabled:data.adminEnabled!==false,capabilities:new Set<string>(Array.isArray(data.capabilities)?data.capabilities:[])};
}

export const controlApi=onRequest({region:"us-central1"},async(req,res)=>{
 try{
  if(req.method==="GET"&&req.path.endsWith("/v1/control/health")){
   res.json({ok:true,environment:process.env.CONTROL_ENV??"staging",version:"1",financialWritesEnabled:false,roleMutationsEnabled:false});
   return;
  }
  if(req.method!=="POST"||!req.path.endsWith("/v1/control/actions")){res.status(404).json({ok:false,code:"not_found"});return;}
  const actor=await actorFrom(req);
  const action=String(req.body?.action??"");
  const reason=String(req.body?.reason??"").trim();
  if(!actor.enabled){res.status(403).json({ok:false,code:"denied"});return;}
  if(reason.length<3){res.status(400).json({ok:false,code:"invalid_reason"});return;}
  // Foundation is fail-closed: privileged mutations stay disabled until each
  // action has an atomic transaction + audit/ledger implementation.
  if(sensitive.has(action)){res.status(503).json({ok:false,code:"trusted_backend_required",message:"Privileged mutation is not enabled yet."});return;}
  res.status(501).json({ok:false,code:"trusted_backend_required",message:"Action handler is not implemented yet."});
 }catch(e:any){
  const code=e?.message==="unauthenticated"?"unauthenticated":"denied";
  res.status(code==="unauthenticated"?401:403).json({ok:false,code});
 }
});
