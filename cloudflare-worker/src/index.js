import { corsHeaders, json } from "./http.js";
import { adjustBalance } from "./adjust-balance.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json(request, env, {
        ok: true,
        service: "shadow-live-cloudflare-worker",
        version: 2,
        firebaseConfigured: Boolean(String(env.FIREBASE_SERVICE_ACCOUNT || "").trim()),
      });
    }

    if (url.pathname === "/api/adjust-balance") {
      return adjustBalance(request, env);
    }

    return json(request, env, { ok: false, code: "route_not_found" }, 404);
  },
};
