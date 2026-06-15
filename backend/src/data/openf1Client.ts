import type {
  OpenF1Session,
  OpenF1Driver,
  OpenF1Lap,
  OpenF1Position,
  OpenF1Interval,
  OpenF1Pit,
  OpenF1Stint,
  OpenF1CarData,
  OpenF1RaceControl,
  TrackStatus,
} from '../types';
import { parseLatestRaceControlStatus } from './raceStatus';

const OPENF1_BASE_URL = process.env.OPENF1_BASE_URL || 'https://api.openf1.org/v1';
const OPENF1_API_KEY = process.env.OPENF1_API_KEY || ''; // Required for live-session telemetry when F1 SignalR auth is unavailable
const OPENF1_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.OPENF1_REQUEST_TIMEOUT_MS ?? '', 10) || 12_000;

export function hasOpenF1ApiKey(): boolean {
  return OPENF1_API_KEY.trim().length > 0;
}
const POLLING_INTERVAL = 10000;
const MAX_RETRIES = 4;
const BASE_BACKOFF = 1000;
const DEBUG_RACE_CONTROL = process.env.DEBUG_RACE_CONTROL === 'true';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FetchType = typeof fetch;

export interface OpenF1ClientOptions {
  onSessionUpdate?: (session: OpenF1Session) => void;
  onLapCompletion?: (lap: OpenF1Lap) => void;
  onPositionUpdate?: (positions: OpenF1Position[]) => void;
  onIntervalUpdate?: (intervals: OpenF1Interval[]) => void;
  onPitUpdate?: (pits: OpenF1Pit[]) => void;
  onStintUpdate?: (stints: OpenF1Stint[]) => void;
  onRaceControlUpdate?: (messages: OpenF1RaceControl[]) => void;
  onError?: (error: Error) => void;
  onFeedStall?: (stalled: boolean) => void;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class OpenF1Client {
  private sessionId: number | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastDataTime: Date | null = null;
  private feedStalled = false;
  private consecutiveErrors = 0;
  private currentBackoff = BASE_BACKOFF;
  private isPolling = false;
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private lastLapNumbers: Map<number, number> = new Map();
  private options: OpenF1ClientOptions;
  private fetchImpl: FetchType;
  private bypassLiveLock = false;
  // Sticky flag — once OpenF1 returns 401 "Live F1 session in progress" we
  // stop banging on data endpoints for the rest of this client's lifetime.
  // SignalR is the source of truth for the live window.
  private static liveLocked = false;

  constructor(options: OpenF1ClientOptions = {}, fetchImpl: FetchType = fetch) {
    this.options = options;
    this.fetchImpl = fetchImpl;
  }

  static isLiveLocked(): boolean {
    return OpenF1Client.liveLocked;
  }

  static resetLiveLock(): void {
    OpenF1Client.liveLocked = false;
  }

  setSession(sessionId: number): void {
    this.sessionId = sessionId;
    this.lastLapNumbers.clear();
    this.lastDataTime = null;
    this.feedStalled = false;
  }

  setBypassLiveLock(value: boolean): void {
    this.bypassLiveLock = value;
  }

  startPolling(): void {
    if (this.pollingInterval) {
      this.stopPolling();
    }

    this.pollingInterval = setInterval(() => {
      this.poll().catch((err) => {
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, POLLING_INTERVAL);

    this.poll().catch((err) => {
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.sessionId || this.isPolling) return;

    this.isPolling = true;

    try {
      const [laps, positions, intervals, pits, stints, raceControl] = await Promise.all([
        this.fetchLaps(),
        this.fetchPositions(),
        this.fetchIntervals(),
        this.fetchPits(),
        this.fetchStints(),
        this.fetchRaceControl(),
      ]);

      if (laps) {
        for (const lap of laps) {
          const lastLap = this.lastLapNumbers.get(lap.driver_number);
          if (lastLap === undefined || lap.lap_number > lastLap) {
            this.lastLapNumbers.set(lap.driver_number, lap.lap_number);
            if (lastLap !== undefined) {
              this.options.onLapCompletion?.(lap);
            }
          }
        }
      }

      const now = new Date();
      if (laps && laps.length > 0) {
        this.lastDataTime = now;
        if (this.feedStalled) {
          this.feedStalled = false;
          this.options.onFeedStall?.(false);
        }
      } else if (this.lastDataTime && now.getTime() - this.lastDataTime.getTime() > 30000) {
        if (!this.feedStalled) {
          this.feedStalled = true;
          this.options.onFeedStall?.(true);
        }
      }

      if (positions) this.options.onPositionUpdate?.(positions);
      if (intervals) this.options.onIntervalUpdate?.(intervals);
      if (pits) this.options.onPitUpdate?.(pits);
      if (stints) this.options.onStintUpdate?.(stints);
      if (raceControl) this.options.onRaceControlUpdate?.(raceControl);

      this.consecutiveErrors = 0;
      this.currentBackoff = BASE_BACKOFF;
    } catch (error) {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= MAX_RETRIES) {
        this.currentBackoff = Math.min(this.currentBackoff * 2, 80000);
      }
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchWithCache<T>(
    endpoint: string,
    params: Record<string, string | number>,
    maxAge = 5000,
    options?: { bypassLiveLock?: boolean }
  ): Promise<T | null> {
    const cacheKey = `${endpoint}?${new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)])
    ).toString()}`;
    const cached = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
    if (cached && Date.now() - cached.timestamp < maxAge) {
      return cached.data;
    }

    // While OpenF1 is locked by an in-progress live session, only the
    // `/sessions` metadata endpoint stays reliably accessible. Skip every
    // data endpoint immediately and return cached value (or null) so we
    // don't spam 401s. SignalR delivers the real-time data instead.
    if (
      OpenF1Client.liveLocked
      && !this.bypassLiveLock
      && !options?.bypassLiveLock
      && !endpoint.startsWith('/sessions')
    ) {
      return cached ? cached.data : null;
    }

    const url = `${OPENF1_BASE_URL}${endpoint}?${new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)])
    )}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const headers: Record<string, string> = {};
        if (OPENF1_API_KEY) {
          headers['Authorization'] = `Bearer ${OPENF1_API_KEY}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), OPENF1_REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
          response = await this.fetchImpl(url, { headers, signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }

        if (response.status === 429 || response.status >= 500) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
          const retryDelay = Number.isFinite(retryAfterSeconds)
            ? retryAfterSeconds * 1000
            : BASE_BACKOFF * 2 ** attempt;

          if (attempt < MAX_RETRIES) {
            await sleep(retryDelay);
            continue;
          }

          throw new Error(`Rate limited or server error: ${response.status}`);
        }
        if (!response.ok) {
          if (response.status === 401) {
            const bodyText = await response.text().catch(() => '');
            if (bodyText.includes('Live F1 session in progress')) {
              if (!OpenF1Client.liveLocked) {
                console.log('[OpenF1] Live session lock detected — suppressing data-endpoint calls until next process restart. SignalR is authoritative.');
              }
              OpenF1Client.liveLocked = true;
              // Don't throw — surface as "no data" so callers degrade silently.
              return cached ? cached.data : null;
            }
          }
          throw new Error(`HTTP error: ${response.status}`);
        }

        const data = (await response.json()) as T;
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF * 2 ** attempt);
          continue;
        }
        if (cached) {
          return cached.data;
        }
        throw error;
      }
    }

    if (cached) {
      return cached.data;
    }

    return null;
  }

  async getSessions(year?: number, meetingKey?: number): Promise<OpenF1Session[] | null> {
    const params: Record<string, string | number> = {};
    if (year) params.year = year;
    if (meetingKey) params.meeting_key = meetingKey;
    return this.fetchWithCache<OpenF1Session[]>('/sessions', params, 60000);
  }

  async getSession(sessionKey: number): Promise<OpenF1Session | null> {
    const sessions = await this.fetchWithCache<OpenF1Session[]>('/sessions', {
      session_key: sessionKey,
    }, 60000);
    return sessions?.[0] ?? null;
  }

  /** Lightweight probe — does not mutate the client's active session. */
  async sessionHasTelemetry(sessionKey: number): Promise<boolean> {
    const laps = await this.fetchWithCache<OpenF1Lap[]>(
      '/laps',
      { session_key: sessionKey },
      60_000,
      { bypassLiveLock: true }
    );
    const hasTelemetry = Array.isArray(laps) && laps.length > 0;
    if (!hasTelemetry) {
      console.warn(`[OpenF1] No lap telemetry rows returned for session ${sessionKey}`);
    }
    return hasTelemetry;
  }

  async getDrivers(): Promise<OpenF1Driver[] | null> {
    if (!this.sessionId) return null;
    return this.fetchWithCache<OpenF1Driver[]>('/drivers', { session_key: this.sessionId }, 30000);
  }

  async fetchLaps(driverNumber?: number): Promise<OpenF1Lap[] | null> {
    if (!this.sessionId) return null;
    const params: Record<string, string | number> = { session_key: this.sessionId };
    if (driverNumber) params.driver_number = driverNumber;
    return this.fetchWithCache<OpenF1Lap[]>('/laps', params, 5000);
  }

  async fetchPositions(): Promise<OpenF1Position[] | null> {
    if (!this.sessionId) return null;
    return this.fetchWithCache<OpenF1Position[]>('/position', { session_key: this.sessionId }, 2000);
  }

  async fetchIntervals(): Promise<OpenF1Interval[] | null> {
    if (!this.sessionId) return null;
    return this.fetchWithCache<OpenF1Interval[]>('/intervals', { session_key: this.sessionId }, 2000);
  }

  async fetchPits(): Promise<OpenF1Pit[] | null> {
    if (!this.sessionId) return null;
    return this.fetchWithCache<OpenF1Pit[]>('/pit', { session_key: this.sessionId }, 5000);
  }

  async fetchStints(): Promise<OpenF1Stint[] | null> {
    if (!this.sessionId) return null;
    return this.fetchWithCache<OpenF1Stint[]>('/stints', { session_key: this.sessionId }, 5000);
  }

  async fetchCarData(driverNumber?: number): Promise<OpenF1CarData[] | null> {
    if (!this.sessionId) return null;
    const params: Record<string, string | number> = { session_key: this.sessionId };
    if (driverNumber) params.driver_number = driverNumber;
    return this.fetchWithCache<OpenF1CarData[]>('/car_data', params, 1000);
  }

  async fetchRaceControl(): Promise<OpenF1RaceControl[] | null> {
    if (!this.sessionId) return null;
    return this.fetchWithCache<OpenF1RaceControl[]>('/race_control', { session_key: this.sessionId }, 2000);
  }

  parseTrackStatus(messages: OpenF1RaceControl[]): TrackStatus {
    const nextStatus = parseLatestRaceControlStatus(messages) ?? 'GREEN';

    if (DEBUG_RACE_CONTROL) {
      const latest = messages
        .slice()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      console.debug('[race-control]', {
        category: latest?.category,
        flag: latest?.flag,
        message: latest?.message,
        nextStatus,
      });
    }

    return nextStatus;
  }

  parseRaceControlStatus(messages: OpenF1RaceControl[]): TrackStatus | null {
    return parseLatestRaceControlStatus(messages);
  }

  isFeedStalled(): boolean {
    return this.feedStalled;
  }

  getSessionId(): number | null {
    return this.sessionId;
  }
}
