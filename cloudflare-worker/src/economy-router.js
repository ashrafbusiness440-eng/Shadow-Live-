import { corsHeaders } from "./http.js";
import { configureLegacyEnv } from "./legacy-firebase-admin-shim.js";
import legacyEconomyRouter from "./economy-router-legacy.js";

function requestHeaders(request) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key.toLowerCase()] = value;
  }
  return headers;
}

function responseAdapter(request, env) {
  let statusCode = 200;
  const headers = new Headers(corsHeaders(request, env));
  return {
    setHeader(name, value) {
      headers.set(name, String(value));
      return this;
    },
    status(code) {
      statusCode = Number(code) || 200;
      return this;
    },
    json(body) {
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(body), { status: statusCode, headers });
    },
    end() {
      return new Response(null, { status: statusCode, headers });
    },
  };
}

export async function economyRouter(request, env, routeOverride = null) {
  configureLegacyEnv(env);
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  if (routeOverride) query.route = String(routeOverride);
  let body = {};
  if (!["GET", "HEAD"].includes(request.method)) {
    try { body = await request.json(); } catch { body = {}; }
  }
  const req = {
    method: request.method,
    headers: requestHeaders(request),
    body,
    query,
  };
  return legacyEconomyRouter(req, responseAdapter(request, env));
}
