type MetricName = string;

interface DurationStats {
  count: number;
  sumMs: number;
  maxMs: number;
  samples: number[];
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  durations: Record<string, {
    count: number;
    avgMs: number;
    maxMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  }>;
  generatedAt: string;
}

const MAX_DURATION_SAMPLES = 2_000;

function percentile(samples: number[], value: number): number {
  if (samples.length === 0) return 0;
  const index = Math.min(
    samples.length - 1,
    Math.max(0, Math.ceil((value / 100) * samples.length) - 1)
  );
  return samples[index];
}

class InMemoryMetrics {
  private counters = new Map<MetricName, number>();
  private gauges = new Map<MetricName, number>();
  private durations = new Map<MetricName, DurationStats>();

  incrementCounter(name: MetricName, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  setGauge(name: MetricName, value: number): void {
    this.gauges.set(name, value);
  }

  recordDuration(name: MetricName, durationMs: number): void {
    const metric = this.durations.get(name) ?? {
      count: 0,
      sumMs: 0,
      maxMs: 0,
      samples: [],
    };
    metric.count += 1;
    metric.sumMs += durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
    metric.samples.push(durationMs);
    if (metric.samples.length > MAX_DURATION_SAMPLES) {
      metric.samples.splice(0, metric.samples.length - MAX_DURATION_SAMPLES);
    }
    this.durations.set(name, metric);
  }

  async trackAsync<T>(name: MetricName, task: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await task();
    } finally {
      this.recordDuration(name, Date.now() - startedAt);
    }
  }

  snapshot(): MetricsSnapshot {
    const durations: MetricsSnapshot['durations'] = {};
    for (const [name, metric] of this.durations.entries()) {
      const sorted = [...metric.samples].sort((a, b) => a - b);
      durations[name] = {
        count: metric.count,
        avgMs: metric.count > 0 ? metric.sumMs / metric.count : 0,
        maxMs: metric.maxMs,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
      };
    }

    return {
      counters: Object.fromEntries(this.counters.entries()),
      gauges: Object.fromEntries(this.gauges.entries()),
      durations,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const metrics = new InMemoryMetrics();
