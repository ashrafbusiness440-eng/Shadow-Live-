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
- Shadow Control CI passes analyzer, admin tests, trusted-backend tests, Firestore Rules emulator compilation, and a release Web build.
- A staging Web artifact is produced from the exact reviewed commit before integration verification.
- Production feature flags remain closed until integration verification is complete.

Current branch remains foundation/staging-safe. Passing unit tests alone does not authorize production financial writes.

## Staging verification

For every candidate commit:
1. Use only the CI-produced `shadow-control-web-<commit>` artifact; do not rebuild ad hoc.
2. Point the Control client at a non-production backend/environment.
3. Verify health/readiness before privileged actions.
4. Test Owner protection, recent re-auth, capability denial, idempotent retry, Emergency Lock, and a non-negative balance adjustment with test accounts only.
5. Confirm an audit record and, for financial actions, a matching immutable ledger record.
6. Do not enable production financial/role mutations until all checks pass and the deployed Functions/Rules versions match the reviewed commit.
