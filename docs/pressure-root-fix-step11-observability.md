# Pressure Root Fix — Step 11 Observability

Date: 26 Sep 2026

## Goal

Measure pressure without creating another pressure source.

Shadow Live uses Cloudflare Workers Logs as the custom operational telemetry sink.
Firestore is never used as a telemetry sink.

Workers Logs / Query Builder were selected as the deployable final path because:
- Workers Logs are already available through the existing Worker observability setting.
- Query Builder requires no separate product enablement.
- Structured `console.log({...})` fields are indexed automatically.
- The Workers Observability REST API can query the same telemetry programmatically.
- Query calculations include count, sum, avg, p50/median, p90, p95, p99 and other aggregates.

Official references:
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- https://developers.cloudflare.com/workers/observability/query-builder/
- https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/

An earlier Analytics Engine binding attempt was rejected at deployment with Cloudflare code 10089 because that product was not enabled on the account. The final design therefore has no Analytics Engine dependency.

## Wrangler configuration

```toml
[observability]
enabled = true

[observability.logs]
invocation_logs = true
head_sampling_rate = 1
```

No Analytics Engine, Firestore, KV, D1 or R2 binding is required for pressure telemetry.

## Privacy and safety

Every custom pressure event has:

`kind = "shadow_pressure"`

The schema intentionally excludes:
- UID
- Room ID
- display/profile data
- message contents
- idempotency keys
- Coins / Diamonds / balances
- gift amounts
- passwords / tokens / authorization headers

Only operational dimensions and counters are logged.

## Structured log schema

Fields:
- `kind` — always `shadow_pressure`
- `pressureKind` — request / firestore / realtime / cron
- `primary` — endpoint, Firestore operation, or subsystem
- `action` — bounded action/event name
- `outcome` — HTTP status or bounded outcome
- `method`
- `colo`
- `durationMs`
- `firestoreReadsEstimate`
- `firestoreWritesEstimate`
- `retries`
- `errorFlag`
- `quotaFlag`
- `reconnectFlag`
- `onlineCount`
- `fanout`

Read/write values are application-layer pressure estimates, not a replacement for Cloudflare/Firebase billing exports.

## Instrumented pressure sources

### Worker requests

Every Worker request records:
- endpoint
- action when known
- HTTP status
- duration
- 5xx/error flag
- quota flag
- reconnect flag
- presenceCounts fanout

Action-aware routers annotate the existing request object. No request body is cloned and no extra network request is made.

The existing Cloudflare `cf-ray` value is emitted only in the separate structured error record for correlation.

### Firestore

The shared `firestoreClient` emits one logical event per Firestore call:
- get
- list
- run_query
- begin_transaction
- commit
- rollback
- estimated document reads/writes
- retry count
- quota event
- circuit-open event
- latency

Retries are measured inside the existing retry loop. Telemetry does not alter retry or financial behavior.

### Room Durable Object / WebSocket

The per-room Durable Object records:
- activation
- connect
- departure
- socket error
- presence_count
- presence_has
- broadcasts and delivered fanout
- alarms
- online count

The Flutter presence client sends its bounded `reconnectAttempt` value inside the ticket request it already makes. This adds no extra request.

### Settlement cron

The Worker records:
- game settlement cron duration
- success/failure
- checked-operation fanout
- quota/error flag

This is observational only; Step 12 still owns the known settlement query/scheduler blocker.

## Query Builder cookbook

Open:
Workers & Pages → shadow-live → Observability → Query Builder.

Base filter for all custom pressure metrics:

```text
kind = "shadow_pressure"
```

### Requests per minute

Filters:
- `kind = "shadow_pressure"`
- `pressureKind = "request"`

Group by:
- `primary`
- `action`

Visualization:
- Count

Use one-minute time buckets in Query Builder.

### p50 / p95 / p99 latency

Filters:
- `kind = "shadow_pressure"`
- `pressureKind = "request"`

Group by:
- `primary`
- `action`

Calculations on `durationMs`:
- Median / p50
- p95
- p99

### 429 / 5xx

Filter by:
- `quotaFlag = 1` for normalized quota events
- or `outcome = "429"`
- or `errorFlag = 1`

Group by:
- `primary`
- `action`
- `outcome`

### Firestore reads / writes / retries / quota

Filters:
- `pressureKind = "firestore"`

Group by:
- `primary` (get/list/run_query/commit/etc.)

Calculations:
- Sum `firestoreReadsEstimate`
- Sum `firestoreWritesEstimate`
- Sum `retries`
- Sum `quotaFlag`
- p95 `durationMs`

### Realtime reconnect and socket health

Filters:
- `pressureKind = "realtime"`

Group by:
- `action`
- `outcome`

Calculations:
- Count
- Sum `reconnectFlag`
- Sum `errorFlag`
- p95 `onlineCount`
- p95 `fanout`

### Home presenceCounts DO fanout

Filters:
- `pressureKind = "request"`
- `primary = "/api/room-realtime"`
- `action = "presenceCounts"`

Calculations:
- Median `fanout`
- p95 `fanout`
- p99 `fanout`

### Room broadcast fanout

Filters:
- `pressureKind = "realtime"`
- `action = "broadcast"`

Group by:
- `outcome` (event type)

Calculations:
- Count
- p95 `fanout`
- p99 `fanout`

## Workers Observability REST API

System Health can query the same data programmatically:

```text
POST /accounts/{account_id}/workers/observability/telemetry/query
```

The API supports calculation operators including:
- count
- sum
- avg
- median
- p90
- p95
- p99

The API token must have a Workers observability permission appropriate for querying telemetry. Current Cloudflare role documentation maps observability read access to the Workers `Metadata Read-Only` role / Workers Observability Read capability.

The account ID and token must remain server-side secrets and must never be shipped to Flutter.

## Shadow Control — System Health read model

The future Owner-only System Health page should query Workers Observability, not Firestore listeners.

Initial cards:
- requests/min
- p50 / p95 / p99 request latency
- 429 / 5xx rate
- Firestore read/write estimates
- Firestore retries and quota events
- Room DO activations
- WebSocket connect/departure/error/reconnect
- presenceCounts p95 fanout
- broadcast p95 fanout
- settlement cron success/failure

Step 11 establishes the write schema and read-query contract.
The visual Shadow Control page remains the later UI task already approved in the root plan.

## Closure rule

Step 11 can close when:
- Worker v28 deploys without an external observability-product dependency,
- `/health` reports `pressureObservability:"workers_logs"` and `workersLogsConfigured:true`,
- CI validates the structured-log schema and guardrails,
- existing room/audio/game/economy behavior has no regression.

Step 12 still owns progressive stress tests, upstream Firestore quota capacity, and the known settlement query/scheduler blocker.
