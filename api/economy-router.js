import { handler as economyControl } from "../server/economy/economy-control.js";
import { handler as giftCatalog } from "../server/economy/gift-catalog.js";
import { handler as giftEconomyConfig } from "../server/economy/gift-economy-config.js";
import { handler as rechargeConfig } from "../server/economy/recharge-config.js";
import { handler as roomRocketConfig } from "../server/economy/room-rocket-config.js";
import { handler as roomRocketRuntime } from "../server/economy/room-rocket-runtime.js";
import { handler as rewardInventory } from "../server/economy/reward-inventory.js";
import { handler as gameRuntime } from "../server/games/game-runtime.js";
import { handler as gameControl } from "../server/games/game-control.js";

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
