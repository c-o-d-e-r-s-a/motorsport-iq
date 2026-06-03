function parseEnvFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Batch leaderboard RPC per resolved question (falls back to per-user RPC). */
export const FF_BATCH_SCORING = parseEnvFlag(process.env.FF_BATCH_SCORING, true);

/** Throttle presence-ping DB writes; flush on disconnect. */
export const FF_PRESENCE_WRITE_THROTTLE = parseEnvFlag(process.env.FF_PRESENCE_WRITE_THROTTLE, true);

/** Emit player deltas instead of full lobby_state on disconnect/reconnect storms. */
export const FF_DELTA_LOBBY_STATE = parseEnvFlag(process.env.FF_DELTA_LOBBY_STATE, true);

/** Enable on-demand live-race simulation (dev/QA only). */
export const SIMULATION_ENABLED = parseEnvFlag(process.env.SIMULATION_ENABLED, false);

function parseEnvNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

/** OpenF1 timeline playback multiplier for simulation (1 = real-time). */
export const SIMULATION_SPEED = parseEnvNumber(process.env.SIMULATION_SPEED, 1);
