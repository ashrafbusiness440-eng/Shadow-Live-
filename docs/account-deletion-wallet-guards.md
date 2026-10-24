# Wallet and account erasure — transaction boundary

Wallet operations remain available during the 30-day cancellation period
when a deletion request is merely pending or review-ready.

At the server's existing financial transaction, before changing either
balance or inserting immutable ledgers, a user document marked
`deletion_processing`, `deletion_completed`, `deleted`,
`deletionProcessing=true` or `authDeleted=true` is rejected with
`wallet_account_deleted` (409). The check applies to:

- diamond exchange to coins,
- transferring diamonds to another user's coin wallet (both parties),
- creation of a new wallet password.

Existing idempotency receipts from previously completed operations remain
readable and no past transaction is silently reversed or recredited.
No additional database reads, listeners, global queries or timers are added.

Emulator integration tests verify no new `wallet_transfers`, ledgers, or
balances change on rejected operations. This does not substitute for
independent refund, Google Play purchase, outstanding balance or chargeback
reconciliation before real deletion. Financial records must be retained,
minimized and access-restricted under an approved policy.
