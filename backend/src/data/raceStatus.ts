import type { OpenF1RaceControl, TrackStatus } from '../types';

type RaceControlLike = Partial<OpenF1RaceControl> & {
  Utc?: string;
  Message?: string;
  Category?: string;
  Flag?: string;
  Scope?: string;
  Sector?: number | string;
  RacingNumber?: number | string;
  DriverNumber?: number | string;
};

const TRACK_STATUS_CODE_MAP: Record<string, TrackStatus> = {
  '1': 'GREEN',
  '2': 'YELLOW',
  '4': 'SC',
  '5': 'RED',
  '6': 'VSC',
  '7': 'VSC',
  '21': 'CHEQUERED',
};

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function messageTime(message: RaceControlLike): number {
  const raw = message.date ?? message.Utc;
  if (!raw) return 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPitExitMessage(message: string): boolean {
  return message.includes('pit exit') || message.includes('pit lane');
}

function mentionsLocalScope(message: string): boolean {
  return (
    /\bsector\b/.test(message)
    || /\bturn\s*\d+\b/.test(message)
    || /\bt\d+\b/.test(message)
    || /\bmarshal(?:ling)? sector\b/.test(message)
    || /\bfor car\s+\d+\b/.test(message)
  );
}

function isGlobalRaceControlMessage(message: RaceControlLike): boolean {
  const scope = normalize(message.scope ?? message.Scope);
  const sector = parsePositiveNumber(message.sector ?? message.Sector);
  const driverNumber = parsePositiveNumber(
    message.driver_number ?? message.RacingNumber ?? message.DriverNumber
  );
  const text = normalize(message.message ?? message.Message);

  if (scope && scope !== 'track' && scope !== 'full track') {
    return false;
  }

  if (sector !== null || driverNumber !== null) {
    return false;
  }

  return !mentionsLocalScope(text);
}

function explicitStatusFromText(text: string): TrackStatus | null {
  if (text.includes('chequered') || text.includes('checkered')) {
    return 'CHEQUERED';
  }

  if (text.includes('red flag')) {
    return 'RED';
  }

  if (text.includes('virtual safety car') || /\bvsc\b/.test(text)) {
    return 'VSC';
  }

  if (text.includes('safety car')) {
    return 'SC';
  }

  if (
    text.includes('track clear')
    || text.includes('track is clear')
    || text.includes('all clear')
    || text.includes('green flag')
  ) {
    return 'GREEN';
  }

  return null;
}

export function parseTrackStatusPayload(params: {
  statusCode?: unknown;
  message?: unknown;
}): TrackStatus | null {
  const statusCode = String(params.statusCode ?? '');
  const message = normalize(params.message);
  const explicitStatus = explicitStatusFromText(message);

  if (explicitStatus) {
    return explicitStatus;
  }

  const mapped = TRACK_STATUS_CODE_MAP[statusCode] ?? null;
  if (mapped === 'YELLOW' && mentionsLocalScope(message)) {
    return null;
  }

  return mapped;
}

export function parseRaceControlMessageStatus(message: RaceControlLike): TrackStatus | null {
  const category = normalize(message.category ?? message.Category);
  const flag = normalize(message.flag ?? message.Flag);
  const text = normalize(message.message ?? message.Message);
  const isGlobal = isGlobalRaceControlMessage(message);

  if (isPitExitMessage(text)) {
    return null;
  }

  if (flag === 'chequered' || flag === 'checkered' || text.includes('chequered') || text.includes('checkered')) {
    return 'CHEQUERED';
  }

  if ((flag === 'red' || text.includes('red flag')) && isGlobal) {
    return 'RED';
  }

  if (
    category === 'safetycar'
    || flag === 'sc'
    || flag === 'vsc'
    || text.includes('safety car')
    || text.includes('virtual safety car')
    || /\bvsc\b/.test(text)
  ) {
    if (text.includes('virtual') || flag === 'vsc' || /\bvsc\b/.test(text)) {
      return 'VSC';
    }
    return 'SC';
  }

  if (
    (flag === 'green'
      || text.includes('green flag')
      || text.includes('track clear')
      || text.includes('track is clear')
      || text.includes('all clear'))
    && isGlobal
  ) {
    return 'GREEN';
  }

  if (
    (flag === 'yellow'
      || flag === 'double yellow'
      || text.includes('yellow flag')
      || text.includes('double yellow'))
    && isGlobal
  ) {
    return 'YELLOW';
  }

  return null;
}

export type SectorFlagAction =
  | { kind: 'set'; sector: number }
  | { kind: 'clear'; sector: number }
  | { kind: 'clearAll' }
  | { kind: 'none' };

/**
 * Classify a single race-control message for the purpose of tracking localized
 * (sector) yellow flags. This is display-only and entirely independent of the
 * global {@link TrackStatus} parsing.
 *
 * - A sector-scoped YELLOW / DOUBLE YELLOW sets that sector yellow.
 * - A sector-scoped CLEAR / GREEN clears that sector.
 * - A global clear/green (track clear, all clear, green flag) clears every
 *   sector. Any global neutralization (SC/VSC/RED) or the chequered flag also
 *   clears every sector, since the global status then drives the display.
 */
export function classifySectorFlag(message: RaceControlLike): SectorFlagAction {
  const flag = normalize(message.flag ?? message.Flag);
  const text = normalize(message.message ?? message.Message);
  const sector = parsePositiveNumber(message.sector ?? message.Sector);
  const isGlobal = isGlobalRaceControlMessage(message);

  // Global states that supersede localized sector cautions on the display.
  const globalStatus = parseRaceControlMessageStatus(message);
  if (
    isGlobal
    && globalStatus
    && globalStatus !== 'YELLOW'
  ) {
    return { kind: 'clearAll' };
  }

  if (sector === null) {
    return { kind: 'none' };
  }

  const isYellow = flag === 'yellow' || flag === 'double yellow'
    || text.includes('yellow');
  if (isYellow) {
    return { kind: 'set', sector };
  }

  const isClear = flag === 'clear' || flag === 'green'
    || text.includes('clear') || text.includes('green');
  if (isClear) {
    return { kind: 'clear', sector };
  }

  return { kind: 'none' };
}

export function parseLatestRaceControlStatus(messages: RaceControlLike[]): TrackStatus | null {
  return parseLatestRaceControlStatusWithTime(messages)?.status ?? null;
}

/**
 * Like {@link parseLatestRaceControlStatus} but also returns the timestamp of
 * the message that produced the status. Callers use the time to reject
 * stale/out-of-order race-control deltas that would otherwise regress the
 * track status (e.g. a previously-seen yellow re-delivered after a green).
 */
export function parseLatestRaceControlStatusWithTime(
  messages: RaceControlLike[]
): { status: TrackStatus; time: number } | null {
  const sorted = [...messages].sort((a, b) => messageTime(b) - messageTime(a));

  for (const message of sorted) {
    const status = parseRaceControlMessageStatus(message);
    if (status) {
      return { status, time: messageTime(message) };
    }
  }

  return null;
}
