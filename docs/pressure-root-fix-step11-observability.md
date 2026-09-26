# Pressure Root Fix — Step 11 Observability

Date: 26 Sep 2026

## Goal

Measure pressure without creating another pressure source.

Shadow Live uses Cloudflare Workers Analytics Engine for custom high-frequency telemetry. Firestore is never used as a telemetry sink.

Dataset: `shadow_live_pressure_v1`
Binding: `PRESSURE_ANALYTICS`

Workers Logs stay enabled for diagnostic invocation/error logs. Custom request telemetry is written to Analytics Engine and does not await network/storage work on the product path.

## Privacy and safety

The telemetry schema intentionally excludes:
- UID
- Room ID
- display/profile data
- message contents
- idempotency keys
- Coins / Diamonds / balances
- gift amounts
- passwords / tokens / authorization headers

Only operational dimensions and counters are stored.

## Schema

Blobs:
1. `kind` — request / firestore / realtime / cron
2. `primary` — endpoint, Firestore operation, or subsystem
3. `action` — bounded action/event name
4. `outcome` — HTTP status or bounded outcome
5. `method`
6. `colo`

Doubles:
1. count
2. duration_ms
3. firestore_reads_estimate
4. firestore_writes_estimate
5. retries
6. error_flag
7. quota_flag
8. reconnect_flag
9. online_count
10. fanout

Read/write values are application-layer pressure estimates, not a replacement for Cloud billing exports.

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

### Firestore

The shared `firestoreClient` records one logical datapoint per Firestore call:
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

Retries are counted inside the existing retry loop. Telemetry does not alter retry or financial behavior.

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

## Query cookbook

All examples query the last hour.

### Requests per minute by endpoint/action

```sql
SELECT
  toStartOfMinute(timestamp) AS minute,
  blob2 AS endpoint,
  blob3 AS action,
  SUM(_sample_interval) AS requests
FROM shadow_live_pressure_v1
WHERE blob1 = 'request'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY minute, endpoint, action
ORDER BY minute DESC, requests DESC
```

### p50 / p95 / p99 request latency

```sql
SELECT
  blob2 AS endpoint,
  blob3 AS action,
  quantileExactWeighted(0.50)(double2, _sample_interval) AS p50_ms,
  quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_ms,
  quantileExactWeighted(0.99)(double2, _sample_interval) AS p99_ms
FROM shadow_live_pressure_v1
WHERE blob1 = 'request'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY endpoint, action
ORDER BY p95_ms DESC
```

### HTTP status / 429 / 5xx distribution

```sql
SELECT
  blob2 AS endpoint,
  blob3 AS action,
  blob4 AS status,
  SUM(_sample_interval) AS requests
FROM shadow_live_pressure_v1
WHERE blob1 = 'request'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY endpoint, action, status
ORDER BY requests DESC
```

### Firestore reads / writes / retries / quota

```sql
SELECT
  blob2 AS operation,
  SUM(_sample_interval * double3) AS read_estimate,
  SUM(_sample_interval * double4) AS write_estimate,
  SUM(_sample_interval * double5) AS retries,
  SUM(_sample_interval * double7) AS quota_events,
  quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_ms
FROM shadow_live_pressure_v1
WHERE blob1 = 'firestore'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY operation
ORDER BY read_estimate DESC
```

### Realtime reconnect and socket health

```sql
SELECT
  blob3 AS event,
  blob4 AS outcome,
  SUM(_sample_interval) AS events,
  SUM(_sample_interval * double8) AS reconnects,
  SUM(_sample_interval * double6) AS errors,
  quantileExactWeighted(0.95)(double9, _sample_interval) AS p95_online
FROM shadow_live_pressure_v1
WHERE blob1 = 'realtime'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY event, outcome
ORDER BY events DESC
```

### Home presenceCounts DO fanout

```sql
SELECT
  quantileExactWeighted(0.50)(double10, _sample_interval) AS p50_rooms,
  quantileExactWeighted(0.95)(double10, _sample_interval) AS p95_rooms,
  quantileExactWeighted(0.99)(double10, _sample_interval) AS p99_rooms
FROM shadow_live_pressure_v1
WHERE blob1 = 'request'
  AND blob2 = '/api/room-realtime'
  AND blob3 = 'presenceCounts'
  AND timestamp > NOW() - INTERVAL '1' HOUR
```

### Room broadcast fanout

```sql
SELECT
  blob4 AS event_type,
  SUM(_sample_interval) AS broadcasts,
  quantileExactWeighted(0.95)(double10, _sample_interval) AS p95_delivered
FROM shadow_live_pressure_v1
WHERE blob1 = 'realtime'
  AND blob3 = 'broadcast'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY event_type
ORDER BY broadcasts DESC
```

## Shadow Control — System Health read model

The future Owner-only System Health page should use Analytics Engine queries, not Firestore listeners.

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

The page/API requires an Account Analytics Read token and Cloudflare account ID. Those credentials must be server-side secrets; they must never be shipped to Flutter.

Step 11 establishes the write schema and read-query contract. The visual Shadow Control page remains the later UI task already approved in the root plan.

## Closure rule

Step 11 can close when:
- the binding is deployed,
- `/health` reports `pressureAnalyticsConfigured:true`,
- CI validates the schema and guardrails,
- existing room/audio/game/economy behavior has no regression.

Step 12 still owns progressive stress tests and upstream quota capacity.
