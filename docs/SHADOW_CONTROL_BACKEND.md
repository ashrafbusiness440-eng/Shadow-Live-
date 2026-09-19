# Shadow Live Control — backend foundation

Control is a separate admin surface using the same Firebase Authentication identity as Shadow Live.

## Authorization
- Never authorize an admin action from UI role text.
- Owner is the protected root role.
- Every non-owner action requires an explicit capability.
- Sensitive economy/role/emergency actions require server-side verification and re-authentication.
- Client-side capability checks are presentation only; Firestore Rules / trusted backend are authoritative.

## Collections
- users/{uid}: role, adminEnabled, capabilities[]
- admin_audit_logs/{id}: actorUid, action, targetType, targetId, reason, before, after, createdAt
- reports/{id}
- financial_ledger/{id}
- system_config/{document}
- agency_settlements/{id}
- store_items/{id}

## Financial invariant
Balances must never be edited as an unlogged standalone write. Every administrative adjustment must create an immutable ledger entry and an audit record in one trusted server transaction.

## Owner protection
Non-owner accounts must never be able to demote, disable, ban, or revoke capabilities from Owner.

## Next backend step
Implement privileged operations in trusted server code and deny direct client writes to protected collections.
