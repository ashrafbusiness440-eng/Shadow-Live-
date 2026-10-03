import { sign } from "node:crypto";

let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof serviceAccount === "string") serviceAccount = JSON.parse(serviceAccount);

const projectId = serviceAccount.project_id;
const clientEmail = serviceAccount.client_email;
const privateKey = String(serviceAccount.private_key || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw Error("invalid service account");

const PAGE_SIZE = 100;
const MAX_PAGES_PER_COLLECTION = 50;
const LEGACY_FIELDS = [
  "level",
  "userLevel",
  "memberLevel",
  "xp",
  "userXp",
  "popularity",
  "popularityLevel",
  "charisma",
  "charismaLevel",
  "appeal",
  "appealLevel",
  "wealth",
  "wealthLevel",
];

function b64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = header + "." + payload;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  const assertion = unsigned + "." + b64url(signature);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth-bearer",
      assertion,
    }),
  });

  let body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const retry = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    body = await retry.json().catch(() => ({}));
    if (!retry.ok || !body.access_token) throw Error("google oauth failed");
  }
  return body.access_token;
}

const accessToken = await googleAccessToken();
const root =
  "https://firestore.googleapis.com/v1/projects/" +
  projectId +
  "/databases/(default)/documents";

function legacyFieldPresent(fields = {}) {
  return LEGACY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(fields, field));
}

async function listPage(collection, pageToken = "") {
  const url = new URL(root + "/" + collection);
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  for (const field of LEGACY_FIELDS) {
    url.searchParams.append("mask.fieldPaths", field);
  }
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const response = await fetch(url, {
    headers: { authorization: "Bearer " + accessToken },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Error(
      "list " + collection + " failed " + response.status + " " + JSON.stringify(body),
    );
  }
  return body;
}

async function deleteLegacyFields(documentName) {
  const updateMask = new URLSearchParams();
  for (const field of LEGACY_FIELDS) {
    updateMask.append("updateMask.fieldPaths", field);
  }

  const response = await fetch(
    "https://firestore.googleapis.com/v1/" +
      documentName +
      "?" +
      updateMask.toString(),
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer " + accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fields: {} }),
    },
  );

  if (!response.ok) {
    throw Error(
      "patch failed " + response.status + " " + (await response.text()),
    );
  }
}

async function migrateCollection(collection) {
  let pageToken = "";
  let scanned = 0;
  let touched = 0;

  for (let page = 0; page < MAX_PAGES_PER_COLLECTION; page++) {
    const body = await listPage(collection, pageToken);
    const docs = body.documents || [];
    scanned += docs.length;

    for (const doc of docs) {
      if (!legacyFieldPresent(doc.fields || {})) continue;
      await deleteLegacyFields(doc.name);
      touched++;
    }

    pageToken = String(body.nextPageToken || "");
    if (!pageToken) {
      console.log(
        collection +
          ": scanned=" +
          scanned +
          " touched=" +
          touched +
          " complete=true",
      );
      return { scanned, touched };
    }
  }

  throw Error(
    collection +
      " migration exceeded bounded limit " +
      PAGE_SIZE * MAX_PAGES_PER_COLLECTION +
      "; rerun with an explicit continuation strategy instead of an unbounded scan",
  );
}

const results = {};
for (const collection of ["users", "public_profiles"]) {
  results[collection] = await migrateCollection(collection);
}

console.log("LEGACY USER LEVEL DATA MIGRATION PASSED", JSON.stringify(results));
