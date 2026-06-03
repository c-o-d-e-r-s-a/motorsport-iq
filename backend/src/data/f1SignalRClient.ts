import zlib from 'node:zlib';
import WebSocket from 'ws';

import type {
  OpenF1Driver,
  OpenF1Interval,
  OpenF1Lap,
  OpenF1Pit,
  OpenF1Position,
  OpenF1Stint,
  TrackStatus,
} from '../types';
import {
  detectPitStopsFromTimingLine,
  extractActiveCompoundsFromTimingAppData,
  mapPitLaneTimeCollectionToPits,
  mapTimingAppDataToStints,
  normalizeCompound,
} from './f1SignalRPitStintMapper';

export interface F1SignalRClientOptions {
  onPositionUpdate?: (positions: OpenF1Position[]) => void;
  onIntervalUpdate?: (intervals: OpenF1Interval[]) => void;
  onLapCompletion?: (lap: OpenF1Lap) => void;
  onTimingProgress?: (maxLap: number) => void;
  onTrackStatusChange?: (status: TrackStatus) => void;
  onTotalLaps?: (totalLaps: number) => void;
  onDriverList?: (drivers: OpenF1Driver[]) => void;
  onStintUpdate?: (stints: OpenF1Stint[]) => void;
  onCompoundUpdate?: (driverNumber: number, compound: string) => void;
  onPitUpdate?: (pits: OpenF1Pit[]) => void;
  onConnectionLoss?: () => void;
  onConnectionRestored?: () => void;
  onConnectionClosedPermanently?: () => void;
}

// F1 live timing topics. Suffix ".z" means base64+raw-deflate compressed.
const SUBSCRIBE_TOPICS = [
  'Heartbeat',
  'CarData.z',
  'Position.z',
  'ExtrapolatedClock',
  'TopThree',
  'TimingStats',
  'TimingAppData',
  'WeatherData',
  'TrackStatus',
  'SessionStatus',
  'SessionData',
  'SessionInfo',
  'DriverList',
  'RaceControlMessages',
  'PitLaneTimeCollection',
  'TeamRadio',
  'LapCount',
  'TimingData',
];

const NEGOTIATE_URL =
  'https://livetiming.formula1.com/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22Streaming%22%7D%5D';
const SOCKET_BASE = 'wss://livetiming.formula1.com/signalr/connect';
const CONNECTION_DATA = encodeURIComponent(JSON.stringify([{ name: 'Streaming' }]));

// F1 TrackStatus.Status numeric codes from livetiming feed.
// Code 2 is often a local/sector yellow — we only treat race-control-backed
// messages as full-track YELLOW. TrackStatus is trusted for GREEN, SC, VSC,
// RED, and CHEQUERED transitions.
const TRACK_STATUS_MAP: Record<string, TrackStatus> = {
  '1': 'GREEN',
  '4': 'SC',
  '5': 'RED',
  '7': 'VSC',
  '21': 'CHEQUERED',
};

function parseTimingValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'object' && raw !== null && 'Value' in raw
    ? String((raw as { Value: unknown }).Value)
    : String(raw);
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'LEADER' || trimmed.startsWith('+LAP')) return null;
  const normalized = trimmed.replace(/^\+/, '');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLapTimeToSeconds(timeStr: string): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  const secondsDirect = parseFloat(timeStr);
  return Number.isFinite(secondsDirect) ? secondsDirect : null;
}

function normalizeDriverListPayload(data: unknown): Record<string, Record<string, unknown>> {
  if (!data || typeof data !== 'object') {
    return {};
  }

  if (Array.isArray(data)) {
    const mapped: Record<string, Record<string, unknown>> = {};
    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const driverNumber = record.RacingNumber ?? record.racingNumber ?? record.DriverNumber ?? record.driver_number;
      if (driverNumber === undefined || driverNumber === null) continue;
      mapped[String(driverNumber)] = record;
    }
    return mapped;
  }

  const root = data as Record<string, unknown>;
  if (root.Drivers && typeof root.Drivers === 'object') {
    return root.Drivers as Record<string, Record<string, unknown>>;
  }

  return root as Record<string, Record<string, unknown>>;
}

function mapDriverListEntry(driverNumber: number, info: Record<string, unknown>): OpenF1Driver {
  const firstName = String(info.FirstName ?? info.firstName ?? '').trim();
  const lastName = String(info.LastName ?? info.lastName ?? '').trim();
  const broadcastName = String(info.BroadcastName ?? info.broadcastName ?? '').trim();
  const fullName = String(info.FullName ?? info.fullName ?? '').trim()
    || [firstName, lastName].filter(Boolean).join(' ').trim()
    || broadcastName
    || `Driver ${driverNumber}`;
  const resolvedBroadcastName = broadcastName || fullName;
  const nameParts = fullName.split(' ').filter(Boolean);
  const resolvedFirstName = firstName || nameParts.slice(0, -1).join(' ') || fullName;
  const resolvedLastName = lastName || nameParts.slice(-1).join(' ') || String(driverNumber);
  const teamName = String(info.TeamName ?? info.teamName ?? info.Team ?? 'Unknown');
  const teamColour = String(info.TeamColour ?? info.teamColour ?? info.TeamColor ?? '000000').replace('#', '');

  return {
    driver_number: driverNumber,
    broadcast_name: resolvedBroadcastName,
    full_name: fullName,
    name_acronym: String(info.Tla ?? info.tla ?? info.RacingNumber ?? driverNumber),
    team_name: teamName,
    team_colour: teamColour,
    first_name: resolvedFirstName,
    last_name: resolvedLastName,
    headshot_url: String(info.HeadshotUrl ?? info.headshotUrl ?? ''),
    country_code: String(info.CountryCode ?? info.countryCode ?? ''),
    session_key: 0,
    meeting_key: 0,
  };
}

function completedLapsToCurrentLap(completedLaps: number): number {
  return completedLaps > 0 ? completedLaps + 1 : 0;
}

export class F1SignalRClient {
  private ws: WebSocket | null = null;
  private invocationId = 0;
  private connected = false;
  private intentionallyClosed = false;
  private reconnectAttempts = 0;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private cookies: string = '';
  private lastCompletedLapByDriver = new Map<number, number>();
  private lastTrackStatus: TrackStatus | null = null;
  private lastPitStopCountByDriver = new Map<number, number>();
  private lastEmittedPitNumberByDriver = new Map<number, number>();
  private inPitByDriver = new Map<number, boolean>();
  private lastLapByDriver = new Map<number, number>();

  constructor(private options: F1SignalRClientOptions = {}) {}

  async start(): Promise<void> {
    this.intentionallyClosed = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.intentionallyClosed = true;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  private async connect(): Promise<void> {
    try {
      const negotiateRes = await fetch(NEGOTIATE_URL, {
        headers: { 'User-Agent': 'BestHTTP' },
      });
      if (!negotiateRes.ok) {
        throw new Error(`Negotiate failed with status ${negotiateRes.status}`);
      }
      const setCookie = negotiateRes.headers.get('set-cookie') || '';
      this.cookies = setCookie
        .split(/,(?=[^;]+=)/)
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');

      const negotiateBody = (await negotiateRes.json()) as { ConnectionToken: string };
      const token = encodeURIComponent(negotiateBody.ConnectionToken);
      console.log('[SignalR] negotiate ok, token acquired');

      const wsUrl =
        `${SOCKET_BASE}?transport=webSockets&clientProtocol=1.5&connectionToken=${token}` +
        `&connectionData=${CONNECTION_DATA}&tid=${Math.floor(Math.random() * 11)}`;

      this.ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent': 'BestHTTP',
          'Accept-Encoding': 'gzip, identity',
          Cookie: this.cookies,
        },
      });

      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastMessageAt = Date.now();
        console.log('[SignalR] WebSocket open. Subscribing to F1 topics...');
        this.options.onConnectionRestored?.();

        const payload = {
          H: 'Streaming',
          M: 'Subscribe',
          A: [SUBSCRIBE_TOPICS],
          I: this.invocationId++,
        };
        this.ws?.send(JSON.stringify(payload));

        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = setInterval(() => {
          if (Date.now() - this.lastMessageAt > 35000) {
            console.warn('[SignalR] No keep-alive for 35s, reconnecting...');
            this.ws?.terminate();
          }
        }, 5000);
      });

      this.ws.on('message', (raw) => {
        this.lastMessageAt = Date.now();
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(msg);
        } catch (e) {
          console.error('[SignalR] Failed to parse message:', e);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.connected = false;
        if (this.keepAliveTimer) {
          clearInterval(this.keepAliveTimer);
          this.keepAliveTimer = null;
        }
        console.warn(`[SignalR] WebSocket closed code=${code} reason=${reason?.toString()}`);
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error('[SignalR] WebSocket error:', err.message);
      });

      this.ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          console.error(`[SignalR] WS unexpected-response status=${res.statusCode} body=${body.slice(0, 300)}`);
        });
      });
    } catch (err) {
      console.error('[SignalR] connect() threw:', err instanceof Error ? err.message : err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 5) {
      console.error('[SignalR] Giving up after 5 reconnect attempts.');
      this.options.onConnectionClosedPermanently?.();
      return;
    }
    const delay = Math.min(30000, 2000 * 2 ** (this.reconnectAttempts - 1));
    console.log(`[SignalR] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/5)...`);
    this.options.onConnectionLoss?.();
    setTimeout(() => {
      if (!this.intentionallyClosed) this.connect();
    }, delay);
  }

  private handleMessage(msg: any): void {
    if (msg.S === 1) {
      console.log('[SignalR] Server confirmed connection initialization.');
      return;
    }
    if (msg.I !== undefined) {
      if (msg.R) {
        console.log('[SignalR] Initial snapshot received for topics:', Object.keys(msg.R).join(', '));
        for (const [topic, payload] of Object.entries(msg.R)) {
          this.dispatchTopic(topic, payload);
        }
      }
      return;
    }
    if (Array.isArray(msg.M)) {
      for (const invocation of msg.M) {
        if (invocation.H === 'Streaming' && invocation.M === 'feed' && Array.isArray(invocation.A)) {
          const [topic, payload] = invocation.A;
          this.dispatchTopic(topic, payload);
        }
      }
    }
  }

  private dispatchTopic(topic: string, payload: any): void {
    if (payload === undefined || payload === null) return;

    const decompressed = topic.endsWith('.z') ? this.decompressPayload(payload) : payload;
    if (!decompressed) return;
    const cleanTopic = topic.replace(/\.z$/, '');

    switch (cleanTopic) {
      case 'Position':
        this.handlePositionData(decompressed);
        break;
      case 'TimingData':
        this.handleTimingData(decompressed);
        break;
      case 'TimingAppData':
        this.handleTimingAppData(decompressed);
        break;
      case 'PitLaneTimeCollection':
        this.handlePitLaneTimeCollection(decompressed);
        break;
      case 'TrackStatus':
        this.handleTrackStatus(decompressed);
        break;
      case 'LapCount':
        this.handleLapCount(decompressed);
        break;
      case 'DriverList':
        this.handleDriverList(decompressed);
        break;
      case 'RaceControlMessages':
        this.handleRaceControlMessages(decompressed);
        break;
      default:
        break;
    }
  }

  private decompressPayload(base64Payload: string): any {
    try {
      if (!base64Payload) return null;
      const buffer = Buffer.from(base64Payload, 'base64');
      const decompressed = zlib.inflateRawSync(buffer);
      return JSON.parse(decompressed.toString('utf-8'));
    } catch (err) {
      console.error('[SignalR Decoder] Error decompressing packet:', err);
      return null;
    }
  }

  private handlePositionData(data: any): void {
    const frames = Array.isArray(data?.Position) ? data.Position : [];
    if (frames.length === 0) return;
    const latest = frames[frames.length - 1];
    const entries = latest?.Entries ?? {};
    const timestamp = latest?.Timestamp ?? new Date().toISOString();

    const mapped: OpenF1Position[] = Object.entries(entries).map(([driverNumber, entry]) => {
      const position = typeof entry === 'object' && entry !== null && 'Position' in entry
        ? parseInt(String((entry as { Position: unknown }).Position), 10)
        : 0;
      return {
        driver_number: parseInt(driverNumber, 10),
        position: Number.isFinite(position) ? position : 0,
        date: timestamp,
        meeting_key: 0,
        session_key: 0,
      };
    });

    if (mapped.length > 0) {
      this.options.onPositionUpdate?.(mapped);
    }
  }

  private handleTimingData(data: any): void {
    if (!data?.Lines) return;

    const timestamp = new Date().toISOString();
    const positions: OpenF1Position[] = [];
    const intervals: OpenF1Interval[] = [];
    let maxLap = 0;

    Object.keys(data.Lines).forEach((driverNumberStr) => {
      const lineData = data.Lines[driverNumberStr];
      const driverNumber = parseInt(driverNumberStr, 10);
      if (!Number.isFinite(driverNumber)) return;

      const positionRaw = lineData.Position ?? lineData.Line;
      const position = parseInt(String(positionRaw ?? ''), 10);
      if (Number.isFinite(position) && position > 0) {
        positions.push({
          driver_number: driverNumber,
          position,
          date: timestamp,
          meeting_key: 0,
          session_key: 0,
        });
      }

      intervals.push({
        driver_number: driverNumber,
        gap_to_leader: parseTimingValue(lineData.GapToLeader),
        interval: parseTimingValue(lineData.IntervalToPositionAhead),
        date: timestamp,
        meeting_key: 0,
        session_key: 0,
      });

      const lapNumber = parseInt(String(lineData.NumberOfLaps ?? ''), 10) || 0;
      if (lapNumber > maxLap) {
        maxLap = lapNumber;
      }
      if (lapNumber > 0) {
        this.lastLapByDriver.set(driverNumber, lapNumber);
      }

      const compound = normalizeCompound(lineData.Compound ?? lineData.compound);
      if (compound) {
        this.options.onCompoundUpdate?.(driverNumber, compound);
      }

      this.processTimingLinePitSignals(driverNumber, lineData, timestamp, lapNumber);

      if (lineData.LastLapTime?.Value && lapNumber > 0) {
        const previousLap = this.lastCompletedLapByDriver.get(driverNumber);
        if (previousLap === undefined) {
          this.lastCompletedLapByDriver.set(driverNumber, lapNumber);
          return;
        }
        if (lapNumber <= previousLap) return;

        this.lastCompletedLapByDriver.set(driverNumber, lapNumber);

        const mappedLap: OpenF1Lap = {
          driver_number: driverNumber,
          lap_number: lapNumber,
          lap_duration: parseLapTimeToSeconds(String(lineData.LastLapTime.Value)),
          is_pit_out_lap: Boolean(lineData.LastLapTime?.LapIsPitOutLap),
          session_key: 0,
          meeting_key: 0,
          lap_time: String(lineData.LastLapTime.Value),
          date_start: timestamp,
          duration_sector_1: null,
          duration_sector_2: null,
          duration_sector_3: null,
          segments_sector_1: [],
          segments_sector_2: [],
          segments_sector_3: [],
        };

        console.log(`[SignalR] Lap completion: driver=${mappedLap.driver_number} lap=${mappedLap.lap_number} time=${mappedLap.lap_time}`);
        this.options.onLapCompletion?.(mappedLap);
      }
    });

    if (maxLap > 0) {
      this.options.onTimingProgress?.(completedLapsToCurrentLap(maxLap));
    }

    if (positions.length > 0) {
      this.options.onPositionUpdate?.(positions);
    }
    if (intervals.length > 0) {
      this.options.onIntervalUpdate?.(intervals);
    }
  }

  private handleTimingAppData(data: any): void {
    const lines = data?.Lines;
    if (!lines || typeof lines !== 'object') {
      return;
    }

    const timestamp = new Date().toISOString();
    const stints = mapTimingAppDataToStints(lines, timestamp);
    if (stints.length > 0) {
      this.options.onStintUpdate?.(stints);
    }

    for (const { driverNumber, compound } of extractActiveCompoundsFromTimingAppData(lines)) {
      this.options.onCompoundUpdate?.(driverNumber, compound);
    }
  }

  private handlePitLaneTimeCollection(data: any): void {
    const timestamp = new Date().toISOString();
    const pits = mapPitLaneTimeCollectionToPits(
      data,
      timestamp,
      this.lastEmittedPitNumberByDriver,
      this.lastLapByDriver
    );

    if (pits.length > 0) {
      this.emitPitUpdates(pits);
    }
  }

  private processTimingLinePitSignals(
    driverNumber: number,
    lineData: Record<string, unknown>,
    timestamp: string,
    lapNumber: number
  ): void {
    const pitStopCountRaw = lineData.NumberOfPitStops;
    const pitStopCount = pitStopCountRaw === undefined || pitStopCountRaw === null
      ? null
      : parseInt(String(pitStopCountRaw), 10);
    const inPitRaw = lineData.InPit;
    const inPit = inPitRaw === undefined || inPitRaw === null ? null : inPitRaw === true;

    if (pitStopCount === null && inPit === null) {
      return;
    }

    const result = detectPitStopsFromTimingLine({
      driverNumber,
      timestamp,
      lapNumber,
      lastKnownLap: this.lastLapByDriver.get(driverNumber) ?? null,
      pitStopCount: Number.isFinite(pitStopCount ?? NaN) ? pitStopCount : null,
      inPit,
      previousPitStopCount: this.lastPitStopCountByDriver.get(driverNumber) ?? 0,
      wasInPit: this.inPitByDriver.get(driverNumber) ?? false,
    });

    this.lastPitStopCountByDriver.set(driverNumber, result.nextPitStopCount);
    this.inPitByDriver.set(driverNumber, result.nextWasInPit);

    if (result.pits.length > 0) {
      this.emitPitUpdates(result.pits);
    }
  }

  private emitPitUpdates(pits: OpenF1Pit[]): void {
    const freshPits: OpenF1Pit[] = [];

    for (const pit of pits) {
      const lastEmitted = this.lastEmittedPitNumberByDriver.get(pit.driver_number) ?? 0;
      if (pit.number <= lastEmitted) {
        continue;
      }

      freshPits.push(pit);
      this.lastEmittedPitNumberByDriver.set(pit.driver_number, pit.number);
      this.lastPitStopCountByDriver.set(
        pit.driver_number,
        Math.max(this.lastPitStopCountByDriver.get(pit.driver_number) ?? 0, pit.number)
      );
    }

    if (freshPits.length > 0) {
      console.log(
        `[SignalR] Pit stop(s): ${freshPits.map((pit) => `#${pit.driver_number} stop=${pit.number} lap=${pit.lap_number}`).join(', ')}`
      );
      this.options.onPitUpdate?.(freshPits);
    }
  }

  private handleTrackStatus(data: any): void {
    const statusCode = String(data?.Status ?? '');
    const message = String(data?.Message ?? '').toLowerCase();
    let status = TRACK_STATUS_MAP[statusCode] ?? null;

    if (message.includes('virtual safety car')) {
      status = 'VSC';
    } else if (message.includes('safety car')) {
      status = 'SC';
    } else if (message.includes('red flag')) {
      status = 'RED';
    } else if (message.includes('chequered')) {
      status = 'CHEQUERED';
    } else if (message.includes('track clear') || message.includes('all clear')) {
      status = 'GREEN';
    }

    if (!status) {
      return;
    }

    if (status === this.lastTrackStatus) return;
    this.lastTrackStatus = status;
    console.log(`[SignalR] Track status: ${status} (code=${statusCode})`);
    this.options.onTrackStatusChange?.(status);
  }

  private handleLapCount(data: any): void {
    const totalLaps = parseInt(String(data?.TotalLaps ?? ''), 10);
    if (Number.isFinite(totalLaps) && totalLaps > 0) {
      this.options.onTotalLaps?.(totalLaps);
    }

    const currentLap = parseInt(String(data?.CurrentLap ?? data?.LapCount ?? ''), 10);
    if (Number.isFinite(currentLap) && currentLap > 0) {
      this.options.onTimingProgress?.(currentLap);
    }
  }

  private handleDriverList(data: any): void {
    const entries = normalizeDriverListPayload(data);
    const drivers: OpenF1Driver[] = Object.entries(entries).map(([driverNumberStr, entry]) => {
      const driverNumber = parseInt(driverNumberStr, 10);
      if (!Number.isFinite(driverNumber)) {
        const fallbackNumber = parseInt(
          String(entry.RacingNumber ?? entry.racingNumber ?? entry.DriverNumber ?? ''),
          10
        );
        if (!Number.isFinite(fallbackNumber)) {
          return null;
        }
        return mapDriverListEntry(fallbackNumber, entry);
      }
      return mapDriverListEntry(driverNumber, entry);
    }).filter((driver): driver is OpenF1Driver => driver !== null);

    if (drivers.length > 0) {
      this.options.onDriverList?.(drivers);
    }
  }

  private handleRaceControlMessages(data: any): void {
    const messages = data?.Messages;
    if (!messages || typeof messages !== 'object') return;

    const entries = Object.values(messages) as Array<{ Utc?: string; Message?: string; Category?: string }>;
    if (entries.length === 0) return;

    const latest = entries.sort((a, b) => {
      const aTime = a.Utc ? new Date(a.Utc).getTime() : 0;
      const bTime = b.Utc ? new Date(b.Utc).getTime() : 0;
      return bTime - aTime;
    })[0];

    const message = String(latest.Message ?? '').toLowerCase();
    let status: TrackStatus | null = null;

    if (message.includes('virtual safety car')) {
      status = 'VSC';
    } else if (message.includes('safety car')) {
      status = 'SC';
    } else if (message.includes('red flag')) {
      status = 'RED';
    } else if (message.includes('chequered')) {
      status = 'CHEQUERED';
    } else if (
      message.includes('yellow flag')
      || message.includes('double yellow')
      || message.includes('yellow in sector')
      || (message.includes('yellow') && !message.includes('yellow card'))
    ) {
      status = 'YELLOW';
    } else if (message.includes('track clear') || message.includes('green flag') || message.includes('track is clear')) {
      status = 'GREEN';
    }

    if (status && status !== this.lastTrackStatus) {
      this.lastTrackStatus = status;
      console.log(`[SignalR] Race control track status: ${status}`);
      this.options.onTrackStatusChange?.(status);
    }
  }
}
