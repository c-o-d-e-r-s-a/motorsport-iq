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

export function parseLatestRaceControlStatus(messages: RaceControlLike[]): TrackStatus | null {
  const sorted = [...messages].sort((a, b) => messageTime(b) - messageTime(a));

  for (const message of sorted) {
    const status = parseRaceControlMessageStatus(message);
    if (status) {
      return status;
    }
  }

  return null;
}
