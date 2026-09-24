import { handler as economyControl } from "./legacy-economy/economy-control.js";
import { handler as giftCatalog } from "./legacy-economy/gift-catalog.js";
import { handler as giftEconomyConfig } from "./legacy-economy/gift-economy-config.js";
import { handler as rechargeConfig } from "./legacy-economy/recharge-config.js";
import { handler as roomRocketConfig } from "./legacy-economy/room-rocket-config.js";
import { handler as roomRocketRuntime } from "./legacy-economy/room-rocket-runtime.js";
import { handler as rewardInventory } from "./legacy-economy/reward-inventory.js";
import { handler as gameRuntime } from "./legacy-games/game-runtime.js";
import { handler as gameControl } from "./legacy-games/game-control.js";

const routes = {
  "economy-control": economyControl,
  "gift-catalog": giftCatalog,
  "gift-economy-config": giftEconomyConfig,
  "recharge-config": rechargeConfig,
  "room-rocket-config": roomRocketConfig,
  "room-rocket": roomRocketRuntime,
  "reward-inventory": rewardInventory,
  "game-runtime": gameRuntime,
  "game-control": gameControl,
};

export default async function handler(req, res) {
  const route = String(req.query?.route || "").trim();
  const target = routes[route];
  if (!target) {
    return res.status(404).json({ ok: false, code: "route_not_found" });
  }
  return target(req, res);
}
