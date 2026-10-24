# Shadow Live — bounded financial erasure review (read-only; production OFF)

The current 17 owner-triggered existence probes can see whether financial
records exist but **cannot** establish complete settlements or data
retention obligations. This helper adds INTERNAL-only, separately invoked
indexed pages, at most **five rows each**, for eight writer-backed
scopes: Google Play purchases by `uid`, financial ledgers by
`userId`, `counterpartyUid` or `counterpartyUids array-contains`,
gift transactions by `senderId` or `receiverId`, and wallet transfers
by `senderUid` or `recipientUid`. Every scope must be paginated
independently with its last document-name cursor.

`inspectAccountFinancialReviewPage(db,{uid,requestId,actor,scope,cursor,limit})`
checks a current review-ready or processing deletion request, matching
checkpoint and user, blocks Owner accounts and report/investigation/legal
holds, then performs ONE filtered query with `limit + 1`. It verifies
each returned indexed UID/counterparty field before processing. The
future external caller must independently authenticate an Owner session
and authorize this operation; `actor.owner` alone is not authentication.
This helper has NO exposed route, cron or background loop.

For the purchase scope only, at most five exact direct
`financial_ledger/play_{purchaseHash}` lookups verify that the writer's
purchase row and immutable ledger agree on user ID, source type and
purchase hash, without exposing token hashes. `refundState` and
`disputeState` different from `none`, or an unexpected credit status,
are flagged for review. A matched ledger and a `none` dispute are
**not** proof of chargeback clearance, Play acknowledgement, refund
eligibility or financial settlement.

Results contain counts and limited flags only: no transaction amounts,
purchase/order IDs, R2 keys, emails, usernames, wallet balances,
recipient details, gifts or raw receipts. The internal pagination
cursor can contain a transaction identifier: never return it verbatim
from a future public API. A future externally exposed implementation
must use a signed, scoped cursor or server-side checkpoint instead.

Every record requires independent settlement/retention review. The
helper never authorizes issuing financial/Play billing certificates,
deleting financial ledgers, refunding purchases, zeroing balances, or
completing an account deletion. Responses ALWAYS set
`exhaustive:false`, `financialSettlementVerified:false`,
`erasureAllowed:false`, `completionVerified:false`. Even an empty
index page does not find legacy unindexed transactions, failed
purchases, callbacks from Google Play, external chargebacks, pending
agency salary/profit, VIP points or gift settlements. Those require
distinct certified workflows before any destructive erasure can begin.

Unit and disposable Firestore Emulator tests cover indexed 5/5/1
pagination, five-at-most exact Play ledger lookups, missing ledgers,
pending disputes, legal holds, cancelled requests, counterpart
privacy, all eight scopes, no financial mutations and fail-closed
invalid input.
