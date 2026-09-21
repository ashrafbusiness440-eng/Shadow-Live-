import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getStorage} from "firebase-admin/storage";

function parseServiceAccount(raw){
  const text=String(raw||"").trim();
  if(!text)throw Error("server_not_configured");
  let sa=JSON.parse(text);
  if(typeof sa==="string")sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
  return {projectId,clientEmail,privateKey};
}

function init(){
  if(!getApps().length){
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({credential:cert(sa),projectId:sa.projectId});
  }
}

function codeOf(error){
  const raw=String(error?.code||error?.message||"unknown");
  return raw.slice(0,120);
}

export default async function handler(req,res){
  if(req.method!=="GET")return res.status(405).json({ok:false,code:"method_not_allowed"});
  try{
    init();
    const candidates=[
      "shadow-live.firebasestorage.app",
      "shadow-live.appspot.com",
    ];
    const results=[];
    for(const name of candidates){
      try{
        const [exists]=await getStorage().bucket(name).exists();
        results.push({name,exists:Boolean(exists)});
      }catch(error){
        results.push({name,exists:null,errorCode:codeOf(error)});
      }
    }
    const active=results.find((x)=>x.exists===true)?.name??null;
    return res.status(active?200:503).json({
      ok:Boolean(active),
      service:"shadow-storage-health",
      activeBucket:active,
      candidates:results,
    });
  }catch(error){
    return res.status(500).json({
      ok:false,
      service:"shadow-storage-health",
      code:"storage_health_failed",
      errorCode:codeOf(error),
    });
  }
}
