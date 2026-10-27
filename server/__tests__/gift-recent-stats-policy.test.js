import assert from "node:assert/strict";
import test from "node:test";
import {
  GIFT_STATS_PAGE_LIMIT,
  safeGiftTransactionRow,
  summarizeRecentGiftTransactions,
} from "../../cloudflare-worker/src/gift-recent-stats-policy.js";

test("report is bounded and never exposes recipient or sender IDs", () => {
  assert.equal(GIFT_STATS_PAGE_LIMIT, 30);
  const row = safeGiftTransactionRow("gift_op1", {
    senderId: "private-user-a",
    receiverId: "private-user-b",
    giftId: "rose",
    giftName: "وردة",
    contextType: "room",
    totalCost: 100,
    paidCost: 0,
    quantity: 2,
    useGiftBag: true,
    createdAt: { toMillis: () => 10000 },
  });
  assert.deepEqual(row, {
    id: "gift_op1",
    giftId: "rose",
    giftName: "وردة",
    context: "room",
    quantity: 2,
    totalCoins: 100,
    paidCoins: 0,
    fromBag: true,
    createdAtMs: 10000,
  });
  assert.equal("senderId" in row, false);
  assert.equal("receiverId" in row, false);
});

test("summary counts actual recipient records, never double counts payment field", () => {
  const rows = [
    safeGiftTransactionRow("a", {giftId:"rose",giftName:"وردة",quantity:2,totalCost:200,paidCost:200,contextType:"room"}),
    safeGiftTransactionRow("b", {giftId:"rose",giftName:"وردة",quantity:3,totalCost:300,paidCost:0,contextType:"chat",useGiftBag:true}),
    safeGiftTransactionRow("c", {giftId:"jet",giftName:"طائرة",quantity:1,totalCost:5000,paidCost:5000,contextType:"diary"}),
  ];
  const v=summarizeRecentGiftTransactions(rows);
  assert.equal(v.entries, 3);
  assert.equal(v.quantities, 6);
  assert.equal(v.totalCoins, 5500);
  assert.equal(v.paidCoins, 5200);
  assert.deepEqual(v.contexts, {room:1, chat:1, diary:1, unknown:0});
  assert.deepEqual(v.topGifts.map(x=>[x.giftId,x.quantity]),[["rose",5],["jet",1]]);
});

test("malformed optional values do not create negative totals", () => {
  const row=safeGiftTransactionRow("x",{
    giftId:"x",contextType:"other",quantity:-3,totalCost:"NaN",paidCost:-4
  });
  const s=summarizeRecentGiftTransactions([row]);
  assert.equal(s.paidCoins,0);assert.equal(s.quantities,0);assert.equal(s.contexts.unknown,1);
});

test("read-only query stays bounded and owner/admin verified", async () => {
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../../cloudflare-worker/src/legacy-economy/gift-catalog.js",import.meta.url),"utf8");
  assert.match(source,/const \{ uid, db \} = await actor\(req\)/);
  assert.match(source,/if \(action === "statsRecent"\)/);
  assert.match(source,/\.orderBy\("createdAt", "desc"\)/);
  assert.match(source,/\.limit\(GIFT_STATS_PAGE_LIMIT \+ 1\)/);
});
