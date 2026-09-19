# Shadow Control implementation progress

Implemented foundation:
- explicit Role != Capabilities authorization model
- Owner protection and sensitive re-auth policy
- Firestore protected-field rules foundation
- immutable Audit/Financial Ledger contracts
- idempotency and negative-balance safeguards
- Emergency Lock model
- recharge/economy/gift/self-gift calculations
- agency attendance/settlement payout policy
- moderation action validation
- VIP privacy + Special ID policy
- room capacity + PK scoring policy
- rankings + login streak missions
- game bet/RTP policy
- Lucky Gift RTP/reference prices
- store categories/durations

Still requires trusted server runtime before production:
- atomic privileged mutations
- purchase-token verification
- withdrawals and settlement execution
- role/capability mutation
- Emergency Lock mutation
- authoritative RNG for games/Lucky Gifts
- deployment and integration tests

Do not expose privileged mutations as direct Firestore client writes.
