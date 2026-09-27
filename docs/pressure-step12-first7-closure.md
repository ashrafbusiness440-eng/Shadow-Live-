# Shadow Live — Step 12 Pressure Before / After

Date: 27 Sep 2026

This document is the closure reference for the first seven Step 12 measurement items.
It describes pressure/reliability changes only. Product semantics remain authoritative in
their existing modules and tests.

## Before → After

| Area | Before | After |
| --- | --- | --- |
| Room presence | Firestore presence heartbeat / duplicated reads were part of the active path | Durable Object / WebSocket presence is the active authority; legacy presence is bounded fallback only where explicitly retained |
| Global Rocket feed | Global Firestore listener over recent explosions | 16-shard Cloudflare realtime feed with bounded recent-event retention |
| Rocket enter/claim retry | UI ticker could amplify network retries | 250ms ticker is UI-only; enter/claim use bounded attempts, exponential backoff and Retry-After |
| Room root on gifts | Gift support counters updated room root and fanned out snapshots to every room listener | Per-gift room-root support writes removed; precise daily/weekly/monthly support docs remain |
| Room root on chat | lastChatAt / updatedAt written on every message | Root touch throttled to at most once per 60 seconds |
| Rocket state | Same room_rocket_state document is read/written by every committed room gift | Behavior preserved and explicitly measured as a hot-document datapoint: 1 read + 1 write per successful gift, plus transaction retry count |
| Support stats | Daily/weekly/monthly room support docs receive gift increments | Same financial/support semantics retained; write topology is now explicitly measured without room IDs |
| Agency stats | Agency period docs and settlement accruals are updated when receiver belongs to an agency | Same settlement/accounting semantics retained; pressure telemetry records only normalized hot-path categories, never agency IDs |
| Game settlement scan | Bounded pending scan could be occupied by future work | Dedicated game_settlement_queue ordered by dueAtMs; bounded max 25; automatic single-field index only |
| Settlement scheduler | Firebase scheduler export could be redeployed next to Cloudflare cron | Firebase scheduled export removed; Cloudflare cron is sole deployed scheduler |
| Observability | Pressure inferred from incidents and isolated logs | Cloudflare Analytics Engine measures requests, latency, Firestore estimates, retries, 429/5xx, reconnects, fanout and normalized resources |
| Control visibility | No owner-facing live pressure status | Shadow Control System Health uses protected Analytics read model, 15s cache and green/yellow/red Health Score |

## Semantics explicitly preserved

- ZEGO remains the voice provider. No Agora path was reintroduced.
- Voice audio continuity, room minimize/restore and mic behavior are unchanged by pressure work.
- Game round timing, forced-round mapping and RTP/economy decisions are not modified by these measurement changes.
- Gift prices, 1 USD = 1 Diamond = 10,000 Coins, host/agency/platform revenue policy and ledger idempotency remain unchanged.
- Rocket thresholds, contributor eligibility, 10-second reward window, top-3 reward rule and prize types are unchanged.
- Firestore remains the source of truth for financial and authorization decisions.
- Pressure Analytics is observational only. It must never become an authority for wallet, gift, game or role mutations.
- Telemetry paths are normalized and must not include uid, roomId, agencyId, objectId, idempotency keys or balances.

## Step 12 measurement evidence

The closure workflow produces three artifacts:

1. pressure-report.json / pressure-report.md
   - requests/min
   - HTTP 429 / 5xx
   - retries / reconnects
   - p50 / p95 / p99
   - Firestore read/write estimates
   - realtime fanout
   - normalized hot-document datapoints

2. listener-budget.json / listener-budget.md
   - all active .snapshots() call sites found in Flutter source
   - room / conversations / current-user / Rocket / profile / wallet categories
   - duplicate-listener signals for later optimization work

3. step12-first7-closure.json / step12-first7-closure.md
   - Home presenceCounts max/batching decision
   - hot-document write topology under measured gift load
   - subsystem latency coverage
   - System Health implementation verification

## Home presenceCounts decision rule

The current implementation accepts at most 60 unique room IDs and reads Durable Objects
in batches of 12 (maximum five batches per request). The measurement report records actual
request fanout and latency. A visible-room subset / active-room index is deferred to the
later improvement card unless measured fanout/latency demonstrates a production need.

## System Health safety

Shadow Control requests one protected System Health snapshot every 15 seconds. The Worker:
- authorizes Owner or explicit viewSystemHealth capability,
- caches the analytics snapshot for 15 seconds,
- reads Cloudflare Analytics Engine using server-side credentials,
- never exposes the Analytics token to Flutter,
- does not poll Firestore for pressure metrics,
- caches capability authorization for 60 seconds to avoid a user-document read every refresh.
