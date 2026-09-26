import { corsHeaders } from "./http.js";
import { configureLegacyEnv } from "./legacy-firebase-admin-shim.js";
import legacyVoiceHandler from "./voice-session-legacy.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

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
      return new Response(JSON.stringify(body), {
        status: statusCode,
        headers,
      });
    },
    end() {
      return new Response(null, {
        status: statusCode,
        headers,
      });
    },
  };
}

export async function voiceSession(request, env) {
  configureLegacyEnv(env);

  let body = {};
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  annotatePressureRequest(request, {
    action: String(body.action || request.method || "").trim(),
  });

  const req = {
    method: request.method,
    headers: requestHeaders(request),
    body,
  };
  const res = responseAdapter(request, env);
  return legacyVoiceHandler(req, res);
}
