import { sign } from "node:crypto";

let tokenCache = null;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function parseServiceAccount(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("server_not_configured");
  let data = JSON.parse(text);
  if (typeof data === "string") data = JSON.parse(data);

  const projectId = data.project_id || data.projectId;
  const clientEmail = data.client_email || data.clientEmail;
  const privateKey = String(data.private_key || data.privateKey || "")
    .replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("invalid_service_account_json");
  }
  return { projectId, clientEmail, privateKey };
}

export async function googleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 90) {
    return tokenCache.token;
  }

  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: sa.clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), sa.privateKey);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error("google_oauth_failed");
  }

  tokenCache = {
    token: body.access_token,
    expiresAt: now + Number(body.expires_in || 3600),
  };
  return tokenCache.token;
}
