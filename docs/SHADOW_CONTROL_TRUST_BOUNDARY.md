# Shadow Control trust boundary

The Flutter client is never the authority for privileged mutations.

## Client may
- authenticate with Firebase Auth;
- render capability-aware UI;
- read only collections allowed by Firestore Rules;
- submit a privileged action request to trusted server code.

## Trusted server must
- verify Firebase ID token;
- reload role/capabilities from authoritative storage;
- enforce Owner protection;
- require recent re-authentication for sensitive operations;
- enforce Emergency Lock;
- validate amount/reason/target;
- enforce idempotency;
- perform balance + immutable ledger + audit writes atomically.

## Client must never
- directly edit coins/diamonds;
- directly grant roles/capabilities;
- directly write audit or ledger entries;
- decide its own permissions from cached UI state;
- bypass Emergency Lock.

This boundary applies to withdrawals, settlements, recharge credits, refunds, VIP/Special ID administrative grants, role changes, permanent bans, and economy configuration.
