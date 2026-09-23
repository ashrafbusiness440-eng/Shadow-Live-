import { handler as economyControl } from "../server/economy/economy-control.js";
import { handler as giftCatalog } from "../server/economy/gift-catalog.js";
import { handler as giftEconomyConfig } from "../server/economy/gift-economy-config.js";
import { handler as rechargeConfig } from "../server/economy/recharge-config.js";

const routes = {
  "economy-control": economyControl,
  "gift-catalog": giftCatalog,
  "gift-economy-config": giftEconomyConfig,
  "recharge-config": rechargeConfig,
};

export default async function handler(req, res) {
  const route = String(req.query?.route || "").trim();
  const target = routes[route];
  if (!target) {
    return res.status(404).json({ ok: false, code: "route_not_found" });
  }
  return target(req, res);
}
