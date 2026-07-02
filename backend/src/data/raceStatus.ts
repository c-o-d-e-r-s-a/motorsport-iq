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

export function messageTime(message: RaceControlLike): number {
  const raw = message.date ?? message.Utc;
  if (!raw) return 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

const SC_VSC_FALSE_POSITIVE_PATTERNS = [
  /safety\s+car\s+line/i,
  /\binfringement\b/i,
  /\bstewards?\b/i,
  /\binvestigation\b/i,
  /\bnoted\b/i,
  /\bformation\b/i,
  /\bwill\s+lead\b/i,
  /\breviewed\b/i,
  /\bno\s+further\s+action\b/i,
];

function isScVscFalsePositive(text: string): boolean {
  return SC_VSC_FALSE_POSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function isVscDeployment(text: string, category: string, flag: string): boolean {
  if (isScVscFalsePositive(text)) {
    return false;
  }

  if (flag === 'vsc') {
    return true;
  }

  if (/\bvsc\s+deployed\b/i.test(text) || /virtual\s+safety\s+car\s+deployed/i.test(text)) {
    return true;
  }

  return category === 'safetycar' && /\bvsc\s+deployed\b/i.test(text);
}

function isScDeployment(text: string, category: string, flag: string): boolean {
  if (isScVscFalsePositive(text)) {
    return false;
  }

  if (flag === 'sc') {
    return true;
  }

  if (/safety\s+car\s+deployed/i.test(text) || /safety\s+car\s+will\s+be\s+deployed/i.test(text)) {
    return true;
  }

  return category === 'safetycar' && /safety\s+car\s+deployed/i.test(text);
}

function isNeutralizationEnding(text: string, flag: string): boolean {
  return /\bvsc\s+ending\b/i.test(text)
    || /safety\s+car\s+in\s+this\s+lap/i.test(text)
    || /\btrack\s+(is\s+)?clear\b/i.test(text)
    || /\ball\s+clear\b/i.test(text)
    || (flag === 'green' && /\bgreen\s+flag\b/i.test(text));
}

function isGlobalTrackClearMessage(message: RaceControlLike): boolean {
  if (!isGlobalRaceControlMessage(message)) {
    return false;
  }

  const flag = normalize(message.flag ?? message.Flag);
  const text = normalize(message.message ?? message.Message);
  return isNeutralizationEnding(text, flag)
    || flag === 'green'
    || text.includes('track clear')
    || text.includes('track is clear')
    || text.includes('all clear')
    || text.includes('green flag');
}

function isGlobalNeutralizationForSectorClear(message: RaceControlLike): boolean {
  if (!isGlobalRaceControlMessage(message)) {
    return false;
  }

  const category = normalize(message.category ?? message.Category);
  const flag = normalize(message.flag ?? message.Flag);
  const text = normalize(message.message ?? message.Message);

  if (isVscDeployment(text, category, flag) || isScDeployment(text, category, flag)) {
    return true;
  }

  if ((flag === 'red' || text.includes('red flag'))) {
    return true;
  }

  return flag === 'chequered' || flag === 'checkered'
    || text.includes('chequered') || text.includes('checkered');
}

function isSectorScopedClear(message: RaceControlLike): boolean {
  const flag = normalize(message.flag ?? message.Flag);
  const text = normalize(message.message ?? message.Message);
  const sector = parsePositiveNumber(message.sector ?? message.Sector);
  if (sector === null) {
    return false;
  }

  return flag === 'clear' || flag === 'green'
    || /\bclear in track sector\b/.test(text)
    || /\bgreen in track sector\b/.test(text);
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

/** SC/VSC/RED neutralize the race and gate question triggers. Yellow does not. */
export function isRaceNeutralized(status: TrackStatus): boolean {
  return status === 'SC' || status === 'VSC' || status === 'RED';
}

function isExplicitGlobalYellow(message: RaceControlLike): boolean {
  const scope = normalize(message.scope ?? message.Scope);
  const text = normalize(message.message ?? message.Message);
  const flag = normalize(message.flag ?? message.Flag);

  const isYellow = flag === 'yellow'
    || flag === 'double yellow'
    || text.includes('yellow flag')
    || text.includes('double yellow');

  if (!isYellow || !isGlobalRaceControlMessage(message)) {
    return false;
  }

  if (scope === 'track' || scope === 'full track') {
    return true;
  }

  // Live timing text-only global yellow (scope often omitted).
  return !scope && text.includes('yellow flag') && !mentionsLocalScope(text);
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

  if (isVscDeployment(text, '', '')) {
    return 'VSC';
  }

  if (isScDeployment(text, '', '')) {
    return 'SC';
  }

  if (isNeutralizationEnding(text, '')) {
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

  if (isVscDeployment(text, category, flag)) {
    return 'VSC';
  }

  if (isScDeployment(text, category, flag)) {
    return 'SC';
  }

  if (isNeutralizationEnding(text, flag) && isGlobal) {
    return 'GREEN';
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

  if (isExplicitGlobalYellow(message)) {
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

  if (isGlobalTrackClearMessage(message) || isGlobalNeutralizationForSectorClear(message)) {
    return { kind: 'clearAll' };
  }

  if (sector === null) {
    return { kind: 'none' };
  }

  const isYellow = flag === 'yellow' || flag === 'double yellow'
    || /\byellow in track sector\b/.test(text)
    || /\bdouble yellow in track sector\b/.test(text);
  if (isYellow) {
    return { kind: 'set', sector };
  }

  if (isSectorScopedClear(message)) {
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

/**
 * Replay state machine: apply a single race-control message to the current
 * track status. Returns the next status when this message is a valid transition,
 * otherwise null (no change). Yellow is display-only and never returned.
 */
export function applyReplayTrackStatusTransition(
  current: TrackStatus,
  message: RaceControlLike
): TrackStatus | null {
  const next = parseRaceControlMessageStatus(message);
  if (!next || next === 'YELLOW') {
    return null;
  }

  if (next === 'GREEN') {
    return 'GREEN';
  }

  if (next === 'SC' || next === 'VSC') {
    return next;
  }

  if (next === 'RED' || next === 'CHEQUERED') {
    return next;
  }

  return current === next ? null : next;
}
