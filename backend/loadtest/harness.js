/* eslint-disable no-console */
/**
 * Socket.io capacity harness — finds real breaking points (ignores configured fallback caps
 * when the server is started with MAX_ACTIVE_LOBBIES / MAX_PLAYERS_PER_LOBBY set very high).
 *
 * Usage (from backend/):
 *   set LOADTEST_URL=http://localhost:4001
 *   node loadtest/harness.js --mode capacity-players
 *   node loadtest/harness.js --mode capacity-lobbies --users-per-lobby 10
 */
const path = require('node:path');
const { io } = require(path.join(__dirname, '../../frontend/node_modules/socket.io-client'));

const BASE_URL = process.env.LOADTEST_URL || 'http://localhost:4000';
const TIMEOUT_MS = Number.parseInt(process.env.LOADTEST_TIMEOUT_MS ?? '20000', 10);
const JOIN_CONCURRENCY = Number.parseInt(process.env.LOADTEST_JOIN_CONCURRENCY ?? '40', 10);
const LOBBY_CONCURRENCY = Number.parseInt(process.env.LOADTEST_LOBBY_CONCURRENCY ?? '15', 10);

const STRICT_SLO = process.env.LOADTEST_STRICT_SLO === 'true';
const SLO = {
  joinP95Ms: 3000,
  createP95Ms: 5000,
  maxFailPct: 2,
};

function parseArgs(argv) {
  const args = {
    mode: 'capacity-players',
    target: 0,
    lobbies: 10,
    usersPerLobby: 10,
    useSimulation: true,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--mode' && next) {
      args.mode = next;
      i += 1;
    } else if (key === '--target' && next) {
      args.target = Number.parseInt(next, 10);
      i += 1;
    } else if (key === '--lobbies' && next) {
      args.lobbies = Number.parseInt(next, 10);
      i += 1;
    } else if (key === '--users-per-lobby' && next) {
      args.usersPerLobby = Number.parseInt(next, 10);
      i += 1;
    } else if (key === '--no-simulation') {
      args.useSimulation = false;
    }
  }
  return args;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(runners);
  return results;
}

function connectClient(label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = io(BASE_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: TIMEOUT_MS,
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${label}: connect timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    socket.on('connect', () => {
      clearTimeout(timer);
      resolve({ socket, connectMs: Date.now() - started, label });
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${label}: ${err.message}`));
    });
  });
}

function once(socket, event, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);

    const onError = (payload) => {
      clearTimeout(timer);
      socket.off(event, onPayload);
      socket.off('error', onError);
      reject(new Error(payload?.message ?? 'socket error'));
    };

    const onPayload = (payload) => {
      clearTimeout(timer);
      socket.off('error', onError);
      resolve(payload);
    };

    socket.once(event, onPayload);
    socket.once('error', onError);
  });
}

async function createLobbyViaSocket(socket, username) {
  const started = Date.now();
  socket.emit('create_lobby', { username });
  const state = await once(socket, 'lobby_state');
  return {
    lobbyId: state.lobbyId,
    code: state.code,
    ms: Date.now() - started,
  };
}

async function startSimulation(socket, username) {
  const started = Date.now();
  socket.emit('start_simulation', { username });
  const state = await once(socket, 'lobby_state');
  return {
    lobbyId: state.lobbyId,
    code: state.code,
    ms: Date.now() - started,
  };
}

async function joinLobby(socket, code, username) {
  const started = Date.now();
  socket.emit('join_lobby', { lobbyCode: code, username });
  await once(socket, 'lobby_state');
  return { ms: Date.now() - started };
}

/** Remove player and delete empty lobbies so capacity checks stay accurate. */
async function leaveAndClose(socket) {
  socket.emit('leave_lobby');
  await new Promise((resolve) => setTimeout(resolve, 300));
  socket.close();
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function summarize(results) {
  const okResults = results.filter((r) => r.ok);
  const failResults = results.filter((r) => !r.ok);
  const latencies = okResults.map((r) => r.ms).filter((ms) => typeof ms === 'number');
  const failPct = results.length === 0 ? 100 : (failResults.length / results.length) * 100;
  const p95 = percentile(latencies, 95);

  const latencyOk = (limit) => p95 === null || p95 <= limit;
  const failOk = failPct <= SLO.maxFailPct;

  return {
    ok: okResults.length,
    fail: failResults.length,
    total: results.length,
    failPct,
    p95Ms: p95,
    sampleErrors: failResults.slice(0, 3).map((r) => r.error),
    pass: failOk && (!STRICT_SLO || latencyOk(SLO.joinP95Ms)),
    createPass: failOk && (!STRICT_SLO || latencyOk(SLO.createP95Ms)),
  };
}

async function runPlayersTest(playerCount, useSimulation) {
  const tag = Date.now();
  const host = await connectClient('host');
  const created = useSimulation
    ? await startSimulation(host.socket, `host-${tag}`)
    : await createLobbyViaSocket(host.socket, `host-${tag}`);

  const joinIndices = Array.from({ length: playerCount - 1 }, (_, i) => i + 1);
  const joinResults = await mapPool(joinIndices, JOIN_CONCURRENCY, async (i) => {
    const label = `player-${i}`;
    try {
      const client = await connectClient(label);
      const joined = await joinLobby(client.socket, created.code, `user-${i}-${tag}`);
      await leaveAndClose(client.socket);
      return { ok: true, ms: joined.ms };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  await leaveAndClose(host.socket);
  const all = [{ ok: true, ms: created.ms }, ...joinResults];
  const summary = summarize(all);
  return { ...summary, lobbyCode: created.code, playerCount };
}

async function runOneLobby(lobbyIndex, usersPerLobby, useSimulation) {
  const tag = `${lobbyIndex}-${Date.now()}`;
  try {
    const host = await connectClient(`lobby-${tag}-host`);
    const created = useSimulation
      ? await startSimulation(host.socket, `host-${tag}`)
      : await createLobbyViaSocket(host.socket, `host-${tag}`);

    const joinIndices = Array.from({ length: usersPerLobby - 1 }, (_, i) => i + 1);
    const joins = await mapPool(joinIndices, JOIN_CONCURRENCY, async (u) => {
      const joiner = await connectClient(`lobby-${tag}-u${u}`);
      const joined = await joinLobby(joiner.socket, created.code, `u${u}-${tag}`);
      await leaveAndClose(joiner.socket);
      return { ok: true, ms: joined.ms };
    });

    await leaveAndClose(host.socket);
    const summary = summarize([{ ok: true, ms: created.ms }, ...joins]);
    return { ok: summary.pass, ms: created.ms, users: usersPerLobby, error: summary.sampleErrors[0] };
  } catch (error) {
    return { ok: false, ms: null, users: usersPerLobby, error: error.message };
  }
}

async function runLobbiesTest(lobbyCount, usersPerLobby, useSimulation) {
  const indices = Array.from({ length: lobbyCount }, (_, i) => i);
  const results = await mapPool(indices, LOBBY_CONCURRENCY, (i) =>
    runOneLobby(i, usersPerLobby, useSimulation)
  );

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  const createMs = results.filter((r) => r.ok && r.ms).map((r) => r.ms);
  const p95 = percentile(createMs, 95);
  const failPct = lobbyCount === 0 ? 100 : (fail / lobbyCount) * 100;

  return {
    ok,
    fail,
    total: lobbyCount,
    failPct,
    p95Ms: p95,
    pass: failPct <= SLO.maxFailPct && (p95 === null || p95 <= SLO.createP95Ms),
    sampleErrors: results.filter((r) => !r.ok).slice(0, 3).map((r) => r.error),
    concurrentUsers: lobbyCount * usersPerLobby,
  };
}

async function fetchScaling() {
  const res = await fetch(`${BASE_URL}/health/scaling`);
  if (!res.ok) {
    throw new Error(`scaling health ${res.status}`);
  }
  return res.json();
}

async function binarySearchCapacity(runFn, low, high, label) {
  let best = low;
  let lastGoodSummary = null;

  console.log(`\n=== Capacity search: ${label} (range ${low}–${high}) ===`);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const started = Date.now();
    const summary = await runFn(mid);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    const pass = summary.pass ?? summary.createPass ?? summary.pass;
    console.log(
      `  try ${mid}: ok=${summary.ok ?? 'n/a'} fail=${summary.fail ?? 0} `
      + `failPct=${(summary.failPct ?? 0).toFixed(1)}% p95=${summary.p95Ms ?? 'n/a'}ms `
      + `elapsed=${elapsed}s → ${pass ? 'PASS' : 'FAIL'}`
    );
    if (summary.sampleErrors?.length) {
      console.log(`    errors: ${summary.sampleErrors.join(' | ')}`);
    }

    if (pass) {
      best = mid;
      lastGoodSummary = summary;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return { max: best, lastGoodSummary };
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`Capacity harness → ${BASE_URL}`);
  const sloNote = STRICT_SLO
    ? `strict: ≤${SLO.maxFailPct}% failures + latency p95 gates`
    : `failure-only: ≤${SLO.maxFailPct}% errors (ignores latency)`;
  console.log(`Pass criteria: ${sloNote}`);
  console.log(`Mode: ${args.mode}`);

  try {
    const scaling = await fetchScaling();
    console.log(
      `Server config caps (ignored for this test if raised): `
      + `lobbies=${scaling.limits?.maxActiveLobbies}, players/lobby=${scaling.limits?.maxPlayersPerLobby}`
    );
    console.log(
      `Pre-test active sockets: ${scaling.metrics?.gauges?.['socket.active_connections'] ?? 'n/a'}`
    );
  } catch (error) {
    console.warn(`Could not read /health/scaling: ${error.message}`);
  }

  if (args.mode === 'capacity-players') {
    const { max, lastGoodSummary } = await binarySearchCapacity(
      (n) => runPlayersTest(n, true),
      10,
      800,
      'players in one simulated lobby'
    );
    console.log('\n========================================');
    console.log(`MAX PLAYERS PER LOBBY (empirical): ${max}`);
    console.log(`  (${lastGoodSummary?.ok ?? '?'} connected, p95 join ${lastGoodSummary?.p95Ms ?? '?'}ms)`);
    console.log('========================================');
    return;
  }

  if (args.mode === 'capacity-lobbies') {
    const usersPerLobby = args.usersPerLobby;
    const { max, lastGoodSummary } = await binarySearchCapacity(
      (n) => runLobbiesTest(n, usersPerLobby, true),
      5,
      150,
      `simulated lobbies × ${usersPerLobby} users`
    );
    console.log('\n========================================');
    console.log(`MAX LOBBIES (empirical): ${max}`);
    console.log(
      `  (${max * usersPerLobby} concurrent users at ${usersPerLobby}/lobby, `
      + `create p95 ${lastGoodSummary?.p95Ms ?? '?'}ms)`
    );
    console.log('========================================');

    try {
      const scaling = await fetchScaling();
      const d = scaling.metrics?.durations ?? {};
      console.log('\nPost-test metrics p95:');
      for (const key of [
        'socket.question_event_delivery_ms',
        'socket.submit_answer_ms',
        'runtime.lap_complete_processing_ms',
      ]) {
        if (d[key]?.p95Ms != null) {
          console.log(`  ${key}: ${d[key].p95Ms}ms`);
        }
      }
      console.log(`  socket.active_connections: ${scaling.metrics?.gauges?.['socket.active_connections']}`);
    } catch {
      // ignore
    }
    return;
  }

  if (args.mode === 'players') {
    const count = args.target || 100;
    const summary = await runPlayersTest(count, args.useSimulation);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (args.mode === 'lobbies') {
    const count = args.target || args.lobbies;
    const summary = await runLobbiesTest(count, args.usersPerLobby, args.useSimulation);
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
