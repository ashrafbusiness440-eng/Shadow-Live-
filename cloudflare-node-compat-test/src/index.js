import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function serviceAccount(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("server_not_configured");
  let value = JSON.parse(text);
  if (typeof value === "string") value = JSON.parse(value);
  return {
    projectId: value.project_id || value.projectId,
    clientEmail: value.client_email || value.clientEmail,
    privateKey: String(value.private_key || value.privateKey || "").replace(/\\n/g, "\n"),
  };
}

function init(env) {
  if (!getApps().length) {
    const sa = serviceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({
      credential: cert(sa),
      projectId: sa.projectId,
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/health") {
      return Response.json({ ok: false, code: "route_not_found" }, { status: 404 });
    }
    try {
      init(env);
      const db = getFirestore();
      await db.collection("users").limit(1).get();
      const auth = getAuth();
      const projectId = auth.app.options.projectId || null;
      return Response.json({
        ok: true,
        firebaseAdmin: true,
        firestore: true,
        auth: true,
        projectId,
      });
    } catch (error) {
      return Response.json({
        ok: false,
        code: "firebase_admin_failed",
        error: String(error?.message || error).slice(0, 300),
      }, { status: 500 });
    }
  },
};
