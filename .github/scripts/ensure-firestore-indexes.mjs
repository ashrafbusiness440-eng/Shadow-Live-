import fs from "node:fs";
import { sign } from "node:crypto";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serviceAccount() {
  let value = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (typeof value === "string") value = JSON.parse(value);
  const projectId = String(value.project_id || "").trim();
  const clientEmail = String(value.client_email || "").trim();
  const privateKey = String(value.private_key || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("invalid service account");
  }
  return { projectId, clientEmail, privateKey };
}

function b64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function accessToken({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + payload;
  const assertion = unsigned + "." + b64url(
    sign("RSA-SHA256", Buffer.from(unsigned), privateKey),
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(
      "oauth failed " + response.status + " " + JSON.stringify(body),
    );
  }
  return body.access_token;
}

function normalizedFields(fields = []) {
  return fields
    .filter((field) => String(field?.fieldPath || "") !== "__name__")
    .map((field) => ({
      fieldPath: String(field?.fieldPath || ""),
      order: field?.order ? String(field.order) : null,
      arrayConfig: field?.arrayConfig ? String(field.arrayConfig) : null,
    }));
}

function sameFields(left = [], right = []) {
  const a = normalizedFields(left);
  const b = normalizedFields(right);
  if (a.length !== b.length) return false;
  return a.every((field, index) =>
    field.fieldPath === b[index].fieldPath &&
    field.order === b[index].order &&
    field.arrayConfig === b[index].arrayConfig
  );
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      "firestore index api failed " +
      response.status +
      " " +
      JSON.stringify(body),
    );
  }
  return body;
}

async function waitReady(index, headers) {
  let current = index;
  for (let attempt = 0; attempt < 144; attempt += 1) {
    if (current.state === "READY") return current;
    if (
      current.state === "NEEDS_REPAIR" ||
      current.state === "ERROR"
    ) {
      throw new Error(
        "firestore index failed " +
        current.name +
        " state=" +
        current.state,
      );
    }
    await sleep(5000);
    current = await jsonFetch(
      "https://firestore.googleapis.com/v1/" + current.name,
      { headers },
    );
  }
  throw new Error("firestore index readiness timeout " + current.name);
}

const { projectId, clientEmail, privateKey } = serviceAccount();
const token = await accessToken({ clientEmail, privateKey });
const headers = {
  authorization: "Bearer " + token,
  "content-type": "application/json",
};
const config = JSON.parse(
  fs.readFileSync("firestore.indexes.json", "utf8"),
);
const desiredIndexes = Array.isArray(config.indexes) ? config.indexes : [];

for (const desired of desiredIndexes) {
  const collectionGroup = String(desired.collectionGroup || "").trim();
  if (!collectionGroup) throw new Error("invalid collectionGroup");
  const queryScope = String(desired.queryScope || "COLLECTION");
  const base =
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) +
    "/databases/(default)/collectionGroups/" +
    encodeURIComponent(collectionGroup) +
    "/indexes";

  const listed = await jsonFetch(base, { headers });
  let index = (listed.indexes || []).find((item) =>
    String(item.queryScope || "COLLECTION") === queryScope &&
    sameFields(item.fields, desired.fields)
  );

  if (!index) {
    index = await jsonFetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        queryScope,
        fields: desired.fields,
      }),
    });
    console.log("Created Firestore index:", index.name);
  } else {
    console.log("Firestore index already exists:", index.name);
  }

  const ready = await waitReady(index, headers);
  console.log("Firestore index READY:", ready.name);
}
