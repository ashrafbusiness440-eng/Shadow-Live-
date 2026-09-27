import { AwsClient } from "aws4fetch";

export const R2_BUCKET_NAME = "shadow-live-storage";
export const R2_PRESIGN_TTL_SECONDS = 300;

const clean = (value) => String(value ?? "").trim();

function requireConfig(env) {
  const accountId = clean(env?.R2_ACCOUNT_ID);
  const accessKeyId = clean(env?.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(env?.R2_SECRET_ACCESS_KEY);
  if (!accountId || !accessKeyId || !secretAccessKey) {
    const error = new Error("r2_presign_not_configured");
    error.code = "r2_presign_not_configured";
    throw error;
  }
  return { accountId, accessKeyId, secretAccessKey };
}

function encodedKey(key) {
  return clean(key)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function clientFor(env) {
  const config = requireConfig(env);
  return {
    ...config,
    client: new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
    }),
  };
}

function objectUrl(accountId, key, expiresSeconds) {
  const url = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${encodedKey(key)}`,
  );
  url.searchParams.set(
    "X-Amz-Expires",
    String(Math.max(30, Math.min(900, Number(expiresSeconds || R2_PRESIGN_TTL_SECONDS)))),
  );
  return url;
}

export async function presignR2Put(
  env,
  { key, mimeType, expiresSeconds = R2_PRESIGN_TTL_SECONDS },
) {
  const { accountId, client } = clientFor(env);
  const url = objectUrl(accountId, key, expiresSeconds);
  const signed = await client.sign(
    new Request(url, {
      method: "PUT",
      headers: { "Content-Type": clean(mimeType).toLowerCase() },
    }),
    { aws: { signQuery: true, allHeaders: true } },
  );
  return signed.url.toString();
}

export async function presignR2Get(
  env,
  { key, expiresSeconds = R2_PRESIGN_TTL_SECONDS },
) {
  const { accountId, client } = clientFor(env);
  const url = objectUrl(accountId, key, expiresSeconds);
  const signed = await client.sign(
    new Request(url, { method: "GET" }),
    { aws: { signQuery: true } },
  );
  return signed.url.toString();
}
