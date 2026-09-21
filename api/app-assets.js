import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

function parseServiceAccount(raw){
 const text=String(raw||"").trim();if(!text)throw Error("server_not_configured");
 let sa=JSON.parse(text);if(typeof sa==="string")sa=JSON.parse(sa);
 const projectId=sa.project_id||sa.projectId,clientEmail=sa.client_email||sa.clientEmail;
 const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
 if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
 return {projectId,clientEmail,privateKey};
}
function init(){
 if(!getApps().length){const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);initializeApp({credential:cert(sa),projectId:sa.projectId});}
}
const out=(res,status,body)=>res.status(status).json(body);

export default async function handler(req,res){
 if(req.method!=="GET")return out(res,405,{ok:false,code:"method_not_allowed"});
 try{
  init();const db=getFirestore();
  const key=String(req.query?.key||"").trim();
  res.setHeader("cache-control","public, max-age=60, s-maxage=300");
  if(key){
   if(!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(key))return out(res,400,{ok:false,code:"invalid_key"});
   const doc=await db.collection("app_asset_registry").doc(key).get();
   if(!doc.exists||doc.data()?.published!==true)return out(res,404,{ok:false,code:"not_found"});
   const d=doc.data()||{};
   return out(res,200,{ok:true,asset:{assetKey:key,rawUrl:d.rawUrl||null,mode:d.mode||"remote",contentSha:d.contentSha||null}});
  }
  const snap=await db.collection("app_asset_registry").where("published","==",true).limit(200).get();
  return out(res,200,{ok:true,assets:snap.docs.map(doc=>({assetKey:doc.id,rawUrl:doc.data()?.rawUrl||null,mode:doc.data()?.mode||"remote",contentSha:doc.data()?.contentSha||null}))});
 }catch(e){
  return out(res,500,{ok:false,code:"server_failed"});
 }
}
