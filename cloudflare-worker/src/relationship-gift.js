const clean = (value) => String(value ?? "").trim();

const FALLBACK_FRIEND_TYPES = Object.freeze([
  "friend",
  "bff",
  "brother",
  "sister",
  "close_friend",
]);

function pathSafe(value) {
  const bytes = new TextEncoder().encode(clean(value));
  return Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function slotPath(uid, type) {
  return "relationship_slots/" + pathSafe(uid) + "__" + clean(type);
}

function categoryOf(gift = {}) {
  const category = clean(gift.category).toLowerCase();
  return category === "cp" || category === "friends" ? category : "";
}

function affinityBasePoints(gift = {}) {
  const value = Number(gift.affinityBasePoints || 0);
  if (
    !Number.isSafeInteger(value) ||
    value < 2 ||
    value > 1000000000 ||
    value % 2 !== 0
  ) {
    throw new Error("invalid_affinity_base_points");
  }
  return value;
}

function friendTypesFromConfig(config = {}) {
  const raw = Array.isArray(config.types) ? config.types : [];
  const values = raw
    .filter((item) => item && item.enabled !== false)
    .map((item) => clean(item.key).toLowerCase())
    .filter(
      (key) =>
        key &&
        key !== "cp" &&
        /^[a-z0-9_]{2,32}$/.test(key),
    )
    .slice(0, 20);
  return values.length
    ? Array.from(new Set(values))
    : [...FALLBACK_FRIEND_TYPES];
}

export async function prepareRelationshipGiftContext(
  db,
  transaction,
  {
    senderUid,
    gift,
  } = {},
) {
  const category = categoryOf(gift);
  if (!category) return null;

  const basePoints = affinityBasePoints(gift);
  let types = ["cp"];
  if (category === "friends") {
    const config = await db.get(
      "system_config/relationship_types",
      transaction,
    );
    types = friendTypesFromConfig(config.exists ? config.data || {} : {});
  }

  const slotSnaps = await Promise.all(
    types.map((type) => db.get(slotPath(senderUid, type), transaction)),
  );
  const byPartner = new Map();
  for (let index = 0; index < types.length; index += 1) {
    const snap = slotSnaps[index];
    if (!snap?.exists) continue;
    const data = snap.data || {};
    const partnerUid = clean(data.partnerUid);
    const relationshipId = clean(data.relationshipId);
    if (!partnerUid || !relationshipId) continue;
    if (!byPartner.has(partnerUid)) {
      byPartner.set(partnerUid, {
        relationshipId,
        relationshipType: clean(data.relationshipType || types[index]),
      });
    }
  }

  return {
    category,
    basePoints,
    byPartner,
  };
}

export async function relationshipGiftWritesForRecipient(
  db,
  transaction,
  context,
  {
    receiverId,
    giftId,
    quantity,
    operationId,
    now,
  } = {},
) {
  if (!context) {
    return {
      writes: [],
      relationshipId: null,
      relationshipType: null,
      affinityBasePoints: 0,
      affinityPointsAwarded: 0,
    };
  }

  const targetUid = clean(receiverId);
  const relation = context.byPartner.get(targetUid);
  if (!relation) throw new Error("relationship_gift_not_eligible");

  const relationshipPath = "relationships/" + relation.relationshipId;
  const relationship = await db.get(relationshipPath, transaction);
  if (!relationship.exists) {
    throw new Error("relationship_gift_not_eligible");
  }
  const data = relationship.data || {};
  const participants = Array.isArray(data.participants)
    ? data.participants.map(clean)
    : [];
  if (
    clean(data.status || "active") !== "active" ||
    !participants.includes(targetUid)
  ) {
    throw new Error("relationship_gift_not_eligible");
  }

  const count = Number(quantity);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("invalid_affinity_quantity");
  }
  const multiplied = context.basePoints * count * 3;
  if (!Number.isSafeInteger(multiplied) || multiplied % 2 !== 0) {
    throw new Error("invalid_affinity_points");
  }
  const points = multiplied / 2;
  const eventId = clean(operationId);
  if (!/^[A-Za-z0-9_-]{12,220}$/.test(eventId)) {
    throw new Error("invalid_relationship_gift_operation");
  }

  return {
    relationshipId: relation.relationshipId,
    relationshipType: relation.relationshipType,
    affinityBasePoints: context.basePoints,
    affinityPointsAwarded: points,
    writes: [
      db.writeUpdate(
        relationshipPath,
        {
          lastAffinityGiftId: clean(giftId),
          lastAffinityGiftAt: now,
          updatedAt: now,
        },
        [
          "lastAffinityGiftId",
          "lastAffinityGiftAt",
          "updatedAt",
        ],
        [
          db.increment("affinityPoints", points),
          db.increment("giftAffinityPoints", points),
          db.increment("affinityGiftCount", count),
        ],
      ),
      db.writeCreate(
        "relationship_affinity_events/" + eventId,
        {
          relationshipId: relation.relationshipId,
          relationshipType: relation.relationshipType,
          sourceType: "gift",
          giftId: clean(giftId),
          senderUid: clean(
            participants.find((uid) => uid !== targetUid) || "",
          ),
          receiverUid: targetUid,
          quantity: count,
          affinityBasePoints: context.basePoints,
          multiplierBps: 15000,
          affinityPointsAwarded: points,
          createdAt: now,
        },
      ),
    ],
  };
}
