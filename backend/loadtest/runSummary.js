/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

const scenarioArg = process.argv[2];
if (!scenarioArg) {
  console.error('Usage: node loadtest/runSummary.js <scenario-file>');
  process.exit(1);
}

const scenarioPath = path.resolve(process.cwd(), scenarioArg);
const raw = fs.readFileSync(scenarioPath, 'utf8');
const scenario = JSON.parse(raw);

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
console.log('Next step: run your load harness with this profile and compare with /health/scaling metrics.');
