# Shadow Control release gate

A Control build must not enable privileged production actions unless all of these are true:

- Firebase Auth identity is verified by trusted server code.
- Role/capabilities are reloaded server-side for each privileged action.
- Owner protection is enforced server-side.
- Sensitive actions require recent re-authentication.
- Emergency Lock is checked before financial/sensitive mutations.
- Financial writes are atomic with immutable ledger and audit records.
- Purchase tokens are verified server-side before recharge credit.
- Direct client writes to balances, roles, audit and ledger remain denied.
- Shadow Control CI passes analyzer and admin tests.
- Production feature flags remain closed until integration verification is complete.

Current branch remains foundation/staging-safe. Passing unit tests alone does not authorize production financial writes.
