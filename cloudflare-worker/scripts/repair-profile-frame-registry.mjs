import { sign } from "node:crypto";

let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof serviceAccount === "string") serviceAccount = JSON.parse(serviceAccount);

const projectId = serviceAccount.project_id;
const clientEmail = serviceAccount.client_email;
const privateKey = String(serviceAccount.private_key || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw Error("invalid service account");

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const FRAME_TEMPLATE_ID = "frame.base.v1";
const FRAME_TYPE = "frame";
const FRAME_PROMPT =
  "Decorative profile frame for Shadow Live. Keep the center transparent and do not bake user names, IDs, or photos into the artwork.";

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
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + payload;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  const assertion = unsigned + "." + b64url(signature);

  const exchange = async (grantType) => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: grantType,
        assertion,
      }),
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  };

  let attempt = await exchange("urn:ietf:params:oauth-bearer");
  if (!attempt.response.ok || !attempt.body.access_token) {
    attempt = await exchange("urn:ietf:params:oauth:grant-type:jwt-bearer");
  }
  if (!attempt.response.ok || !attempt.body.access_token) {
    throw Error("google oauth failed");
  }
  return attempt.body.access_token;
}

const accessToken = await googleAccessToken();
const root =
  "https://firestore.googleapis.com/v1/projects/" +
  projectId +
  "/databases/(default)/documents";

function stringField(fields, key) {
  return String(fields?.[key]?.stringValue || "").trim();
}

function mapFields(fields, key) {
  return fields?.[key]?.mapValue?.fields || {};
}

function docId(name) {
  return String(name || "").split("/").pop() || "";
}

function isProfileFrameIdentity(id, fields) {
  const key = (stringField(fields, "assetKey") || id).toLowerCase();
  const fileName = stringField(fields, "fileName").toLowerCase();
  const fullPath = stringField(fields, "fullPath").toLowerCase();
  const draft = mapFields(fields, "draft");
  const draftFile = stringField(draft, "fileName").toLowerCase();
  const draftPath = stringField(draft, "fullPath").toLowerCase();
  return (
    key.endsWith(".profileframe") ||
    fileName.includes("_profile_frame.") ||
    fullPath.includes("_profile_frame.") ||
    draftFile.includes("_profile_frame.") ||
    draftPath.includes("_profile_frame.")
  );
}

function frameTemplateSpecsValue() {
  return {
    mapValue: {
      fields: {
        id: { stringValue: FRAME_TEMPLATE_ID },
        type: { stringValue: FRAME_TYPE },
        version: { integerValue: "1" },
        maxBytes: { integerValue: "2500000" },
        width: { nullValue: null },
        height: { nullValue: null },
        dimensionsStatus: { stringValue: "tbd" },
        transparency: { stringValue: "required" },
        motion: { stringValue: "static_or_animated" },
        extensions: {
          arrayValue: {
            values: ["webp", "png", "gif"].map((value) => ({ stringValue: value })),
          },
        },
      },
    },
  };
}

function needsRepair(fields) {
  const topWrong =
    stringField(fields, "assetType") !== FRAME_TYPE ||
    stringField(fields, "templateId") !== FRAME_TEMPLATE_ID;
  const draft = mapFields(fields, "draft");
  const hasDraft = fields?.hasDraft?.booleanValue === true && Object.keys(draft).length > 0;
  const draftWrong = hasDraft && (
    stringField(draft, "assetType") !== FRAME_TYPE ||
    stringField(draft, "templateId") !== FRAME_TEMPLATE_ID
  );
  return { topWrong, draftWrong };
}

async function listPage(pageToken = "") {
  const url = new URL(root + "/app_asset_registry");
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await fetch(url, {
    headers: { authorization: "Bearer " + accessToken },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Error("list failed " + response.status + " " + JSON.stringify(body));
  }
  return body;
}

async function repairDocument(documentName, { topWrong, draftWrong }) {
  const fieldPaths = [];
  const fields = {};

  if (topWrong) {
    fields.assetType = { stringValue: FRAME_TYPE };
    fields.templateId = { stringValue: FRAME_TEMPLATE_ID };
    fields.templateVersion = { integerValue: "1" };
    fields.templateSpecs = frameTemplateSpecsValue();
    fields.prompt = { stringValue: FRAME_PROMPT };
    fieldPaths.push(
      "assetType",
      "templateId",
      "templateVersion",
      "templateSpecs",
      "prompt",
    );
  }

  if (draftWrong) {
    fields.draft = {
      mapValue: {
        fields: {
          assetType: { stringValue: FRAME_TYPE },
          templateId: { stringValue: FRAME_TEMPLATE_ID },
          templateVersion: { integerValue: "1" },
          templateSpecs: frameTemplateSpecsValue(),
          prompt: { stringValue: FRAME_PROMPT },
        },
      },
    };
    fieldPaths.push(
      "draft.assetType",
      "draft.templateId",
      "draft.templateVersion",
      "draft.templateSpecs",
      "draft.prompt",
    );
  }

  const query = new URLSearchParams();
  for (const path of fieldPaths) query.append("updateMask.fieldPaths", path);
  const response = await fetch(
    "https://firestore.googleapis.com/v1/" + documentName + "?" + query.toString(),
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer " + accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fields }),
    },
  );
  if (!response.ok) {
    throw Error(
      "repair failed " + response.status + " " + (await response.text()),
    );
  }
}

let pageToken = "";
let scanned = 0;
let profileFrames = 0;
let repaired = 0;
let alreadyCorrect = 0;

for (let page = 0; page < MAX_PAGES; page++) {
  const body = await listPage(pageToken);
  const docs = body.documents || [];
  scanned += docs.length;

  for (const doc of docs) {
    const fields = doc.fields || {};
    const id = docId(doc.name);
    if (!isProfileFrameIdentity(id, fields)) continue;
    profileFrames++;

    const repair = needsRepair(fields);
    if (!repair.topWrong && !repair.draftWrong) {
      alreadyCorrect++;
      continue;
    }

    await repairDocument(doc.name, repair);
    repaired++;
    console.log(
      "repaired profile frame registry metadata:",
      id,
      "top=" + repair.topWrong,
      "draft=" + repair.draftWrong,
    );
  }

  pageToken = String(body.nextPageToken || "");
  if (!pageToken) {
    console.log(
      "PROFILE FRAME REGISTRY REPAIR PASSED",
      JSON.stringify({ scanned, profileFrames, repaired, alreadyCorrect }),
    );
    process.exit(0);
  }
}

throw Error(
  "profile frame registry repair exceeded bounded limit " +
    PAGE_SIZE * MAX_PAGES +
    "; use an explicit continuation strategy",
);
