const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const rate = (value, total) =>
  total > 0 ? Math.max(0, Number(value) || 0) / total : 0;

export function computeSystemHealth({
  current = {},
  baseline = {},
  topEndpoint = null,
} = {}) {
  const requests = Math.max(0, Number(current.requests || 0));
  const status429 = Math.max(0, Number(current.status429 || 0));
  const status5xx = Math.max(0, Number(current.status5xx || 0));
  const quotaEvents = Math.max(0, Number(current.quotaEvents || 0));
  const retries = Math.max(0, Number(current.retries || 0));
  const reconnects = Math.max(0, Number(current.reconnects || 0));
  const p95Ms = Math.max(0, Number(current.p95Ms || 0));
  const p99Ms = Math.max(0, Number(current.p99Ms || 0));
  const rpm = Math.max(0, Number(current.requestsPerMinute || 0));
  const readsPerMinute = Math.max(
    0,
    Number(current.firestoreReadsPerMinute || 0),
  );
  const writesPerMinute = Math.max(
    0,
    Number(current.firestoreWritesPerMinute || 0),
  );
  const baselineRpm = Math.max(0, Number(baseline.requestsPerMinute || 0));
  const baselineReadsPerMinute = Math.max(
    0,
    Number(baseline.firestoreReadsPerMinute || 0),
  );
  const baselineWritesPerMinute = Math.max(
    0,
    Number(baseline.firestoreWritesPerMinute || 0),
  );

  let score = 100;
  const reasons = [];

  if (quotaEvents > 0 || status429 > 0) {
    score -= 45;
    reasons.push(
      quotaEvents > 0
        ? `Firestore quota detected (${quotaEvents})`
        : `HTTP 429 detected (${status429})`,
    );
  }

  const errorRate = rate(status5xx, requests);
  if (errorRate >= 0.02) {
    score -= 30;
    reasons.push(`5xx rate ${(errorRate * 100).toFixed(1)}%`);
  } else if (errorRate >= 0.005) {
    score -= 15;
    reasons.push(`5xx rate ${(errorRate * 100).toFixed(1)}%`);
  } else if (status5xx > 0) {
    score -= 5;
    reasons.push(`${status5xx} HTTP 5xx`);
  }

  if (p95Ms >= 3000) {
    score -= 25;
    reasons.push(`p95 high at ${Math.round(p95Ms)} ms`);
  } else if (p95Ms >= 1500) {
    score -= 15;
    reasons.push(`p95 elevated at ${Math.round(p95Ms)} ms`);
  } else if (p95Ms >= 800) {
    score -= 8;
    reasons.push(`p95 above target at ${Math.round(p95Ms)} ms`);
  }

  if (p99Ms >= 5000) {
    score -= 10;
    reasons.push(`p99 high at ${Math.round(p99Ms)} ms`);
  } else if (p99Ms >= 2500) {
    score -= 5;
    reasons.push(`p99 elevated at ${Math.round(p99Ms)} ms`);
  }

  const retryRate = rate(retries, requests);
  if (retryRate >= 0.05) {
    score -= 15;
    reasons.push(`retry rate ${(retryRate * 100).toFixed(1)}%`);
  } else if (retryRate >= 0.01) {
    score -= 7;
    reasons.push(`retry rate ${(retryRate * 100).toFixed(1)}%`);
  }

  const reconnectRate = rate(reconnects, requests);
  if (reconnectRate >= 0.10) {
    score -= 10;
    reasons.push(`reconnect rate ${(reconnectRate * 100).toFixed(1)}%`);
  } else if (reconnectRate >= 0.03) {
    score -= 5;
    reasons.push(`reconnect rate ${(reconnectRate * 100).toFixed(1)}%`);
  }

  if (baselineRpm > 0 && requests >= 20) {
    const multiplier = rpm / baselineRpm;
    if (multiplier >= 3) {
      score -= 10;
      reasons.push(`traffic ${multiplier.toFixed(1)}x baseline`);
    } else if (multiplier >= 2) {
      score -= 5;
      reasons.push(`traffic ${multiplier.toFixed(1)}x baseline`);
    }
  }

  const ioSignals = [
    {
      label: "Firestore reads",
      current: readsPerMinute,
      baseline: baselineReadsPerMinute,
    },
    {
      label: "Firestore writes",
      current: writesPerMinute,
      baseline: baselineWritesPerMinute,
    },
  ];
  for (const signal of ioSignals) {
    if (signal.baseline <= 0 || signal.current < 1) continue;
    const multiplier = signal.current / signal.baseline;
    if (multiplier >= 3) {
      score -= 7;
      reasons.push(`${signal.label} ${multiplier.toFixed(1)}x baseline`);
    } else if (multiplier >= 2) {
      score -= 3;
      reasons.push(`${signal.label} ${multiplier.toFixed(1)}x baseline`);
    }
  }

  score = Math.round(clamp(score, 0, 100));
  if (quotaEvents > 0 || status429 > 0) score = Math.min(score, 49);

  const state = score >= 80 ? "green" : score >= 50 ? "yellow" : "red";
  const label = state === "green"
    ? "طبيعي"
    : state === "yellow"
      ? "ضغط متوسط"
      : "ضغط عالي";

  if (reasons.length === 0) {
    reasons.push("All monitored pressure indicators are within target");
  }
  if (topEndpoint && p95Ms >= 800) {
    const route = String(topEndpoint.route || "").trim();
    const action = String(topEndpoint.action || "").trim();
    if (route) {
      reasons.unshift(
        `slowest active path: ${route}${action ? ` / ${action}` : ""}`,
      );
    }
  }

  return {
    score,
    state,
    label,
    reasons: reasons.slice(0, 4),
  };
}
