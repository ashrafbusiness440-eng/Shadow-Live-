export function economyPermissions(user = {}) {
  const capabilities=Array.isArray(user.capabilities)?user.capabilities:[];
  const isOwner=user.role==="owner";
  const adminEnabled=user.adminEnabled===true;
  const canEconomy=isOwner||(adminEnabled&&capabilities.includes("manageEconomy"));
  const canAdjustBalances=isOwner||(adminEnabled&&capabilities.includes("adjustBalances"));
  const canManageSettlements=isOwner||(adminEnabled&&capabilities.includes("manageSettlements"));
  const canManageAgencySettlements=isOwner||(adminEnabled&&capabilities.includes("manageAgencySettlements"));
  return {
    isOwner,
    canEconomy,
    canAdjustBalances,
    canManageSettlements,
    canManageAgencySettlements,
    canSettle:canEconomy&&canManageSettlements,
    canSettleAgency:canEconomy&&canManageSettlements&&canManageAgencySettlements,
  };
}
