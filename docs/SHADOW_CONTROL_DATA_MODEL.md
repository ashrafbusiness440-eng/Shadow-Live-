# Shadow Control data model

## Protected administration
users/{uid}
- role: user | moderator | admin | super_admin | owner
- adminEnabled: bool
- capabilities: string[]

## Immutable audit
admin_audit_logs/{id}
- actorUid, action, targetType, targetId, reason
- before, after, createdAt

## Financial ledger
financial_ledger/{id}
- userId
- asset: coins | diamonds
- delta
- reason
- sourceType/sourceId
- actorUid
- idempotencyKey
- createdAt

A trusted backend transaction must:
1. verify the caller and explicit capability;
2. reject protected Owner targets for non-owner callers;
3. verify idempotencyKey;
4. write ledger entry;
5. update balance atomically;
6. write audit record.

Direct client writes to ledger, admin audit, role/capability fields, system config, settlements and protected balances must be denied.
