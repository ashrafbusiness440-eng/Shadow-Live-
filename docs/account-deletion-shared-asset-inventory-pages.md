# Shadow Live — shared room and agency ownership inventory (internal / OFF)

Owned rooms and agencies are shared assets: deleting the account must
not implicitly remove other participants, hosts, gift histories or
agency salary ledgers. The existing 17 existence probes do not enumerate
ownership. This module supplies **read-only cursor paging**, not
ownership transfer, closure or approval.

`inspectAccountSharedAssetsPage(db,{uid,requestId,actor,kind,cursor,limit})`
supports three *separate* indexed queries, at most five resources per
page: `rooms_owner_uid` (`rooms.ownerUid == uid`),
`rooms_legacy_owner_id` (`rooms.ownerId == uid`), and
`agencies_owned` (`agencies.ownerUid == uid`). Each is
document-ID ordered with a stable cursor; a row is revalidated to match
the requested owner. The legacy `ownerId` may contain a *public ID*
instead of a Firebase UID, so this path does not establish complete
legacy coverage. Rows overlapping the two room queries may repeat
and must be deduplicated in the future finalizer.

For every owned agency, exact `agency_memberships/{agencyId}__{uid}`
and `agency_user_memberships/{uid}` records are inspected, including
their owner role, active state and legal holds. Missing or inconsistent
ownership is flagged. All agencies require **independent transfer or
closure policy and financial settlement review**, even if the
membership looks consistent. Every owned room also requires an
explicit transfer/closure decision, including rooms linked to an
agency. No actual room, membership, role, score or wallet is modified.

Gates: an externally authenticated Owner-only caller (not exposed
through HTTP yet), current matching deletion request and checkpoint,
`review_ready` or `processing`, non-Owner account and no account
or request legal/evidence/review hold. This code has **no HTTP route,
cron, Firestore writes, R2 work, Firebase Auth call or background scan**.

Output contains only opaque resource IDs and integrity/review flags,
never room names, user members, agency names, host contacts, agency
payments or private history. No found rows and cursor exhaustion are
NOT a shared-assets release certificate: unindexed legacy rooms,
agency manager slots, cross-agency memberships, ownership transfers,
pending application disputes and other people's balances may still
exist. Responses always set `exhaustive:false`,
`ownershipTransferred:false`, `erasureAllowed:false` and
`completionVerified:false`. Production deletion remains disabled.

Node and disposable Firestore Emulator tests cover paging, current
versus legacy room ownership, agency membership consistency,
legal holds, foreign ownership, cancelled requests, and preservation
of counterpart rooms, balances and agency hosts.
