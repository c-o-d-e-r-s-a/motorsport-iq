/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

const scenarioArg = process.argv[2];
const metricsArg = process.argv[3];

if (!scenarioArg) {
  console.error('Usage: node loadtest/runSummary.js <scenario-file> [metrics-snapshot.json]');
  process.exit(1);
}

const scenarioPath = path.resolve(process.cwd(), scenarioArg);
const raw = fs.readFileSync(scenarioPath, 'utf8');
const scenario = JSON.parse(raw);

const METRIC_KEYS = {
  questionEventP95Ms: 'socket.question_event_delivery_ms',
  submitAnswerAckP95Ms: 'socket.submit_answer_ms',
  resolutionPublishP95Ms: 'socket.resolution_broadcast_ms',
  reconnectRecoveryP95Ms: 'socket.reconnect_recovery_ms',
};

function readMetricsSnapshot() {
  if (!metricsArg) {
    return null;
  }

  const metricsPath = path.resolve(process.cwd(), metricsArg);
  const metricsRaw = fs.readFileSync(metricsPath, 'utf8');
  return JSON.parse(metricsRaw);
}

function evaluateSlo(scenarioSlo, metricsSnapshot) {
  if (!metricsSnapshot || !scenarioSlo) {
    return { evaluated: false, results: [] };
  }

  const durations = metricsSnapshot.durations ?? {};
  const results = [];

  for (const [sloKey, threshold] of Object.entries(scenarioSlo)) {
    if (sloKey === 'criticalEventDropRatePct') {
      results.push({
        key: sloKey,
        threshold,
        actual: 'n/a (requires harness drop counters)',
        pass: null,
      });
      continue;
    }

    const metricKey = METRIC_KEYS[sloKey];
    const actual = metricKey ? durations[metricKey]?.p95Ms ?? null : null;
    results.push({
      key: sloKey,
      metricKey,
      threshold,
      actual,
      pass: actual === null ? null : actual <= threshold,
    });
  }

  const evaluated = results.some((result) => result.pass !== null);
  const pass = results.every((result) => result.pass !== false);

  return { evaluated, pass, results };
}

console.log('========================================');
console.log(`Load Test Scenario: ${scenario.name}`);
console.log('========================================');
console.log(`Concurrent users: ${scenario.targets.concurrentUsers}`);
console.log(`Lobbies: ${scenario.targets.lobbies}`);
console.log(`Users/lobby: ${scenario.targets.usersPerLobby}`);
console.log(`Duration: ${scenario.targets.durationMinutes} minutes`);
console.log('');
console.log('SLO gates:');
for (const [key, value] of Object.entries(scenario.slo ?? {})) {
  console.log(`- ${key}: ${value}`);
}
console.log('');

const metricsSnapshot = readMetricsSnapshot();
const evaluation = evaluateSlo(scenario.slo, metricsSnapshot);

if (!metricsSnapshot) {
  console.log('Metrics snapshot: not provided');
  console.log('');
  console.log('Next steps:');
  console.log('1. Run your load harness against this profile.');
  console.log('2. Capture GET /health/scaling or GET /metrics output to a JSON file.');
  console.log('3. Re-run: node loadtest/runSummary.js <scenario> <metrics.json>');
  process.exit(0);
}

console.log('Metrics snapshot loaded.');
console.log(`Generated at: ${metricsSnapshot.generatedAt ?? 'unknown'}`);
console.log('');

if (!evaluation.evaluated) {
  console.log('SLO evaluation: skipped (no matching duration metrics in snapshot)');
  process.exit(0);
}

console.log('SLO evaluation:');
for (const result of evaluation.results) {
  if (result.pass === null) {
    console.log(`- ${result.key}: ${result.actual} (threshold ${result.threshold}) — manual check`);
    continue;
  }

  const status = result.pass ? 'PASS' : 'FAIL';
  console.log(`- ${result.key}: ${result.actual}ms vs ${result.threshold}ms — ${status}`);
}

console.log('');
console.log(`Overall: ${evaluation.pass ? 'PASS' : 'FAIL'}`);
process.exit(evaluation.pass ? 0 : 1);
