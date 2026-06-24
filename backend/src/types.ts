// Shared types for the Motorsport IQ application

// Driver state at a point in time
export interface DriverState {
  driverNumber: number;
  name: string;
  nameSource?: 'full_name' | 'broadcast_name' | 'unknown';
  lastTelemetryTimestamp?: string | null;
  team: string;
  position: number;
  gap: number | null; // Gap to leader in seconds
  interval: number | null; // Gap to car ahead in seconds
  tyreCompound: string | null;
  tyreAge: number;
  stintNumber: number | null;
  overtakeModeArmed: boolean;
  pitCount: number;
  lastLapTime: number | null;
  inPit: boolean;
  retired: boolean;
}

export interface LeaderStats {
  name: string;
  team: string;
  tyreCompound: string | null;
  tyreAge: number;
  stintNumber: number | null;
}

// Track status types
export type TrackStatus = 'GREEN' | 'YELLOW' | 'SC' | 'VSC' | 'RED' | 'CHEQUERED';
export type SessionMode = 'live' | 'replay';
export type ProblemReportReason =
  | 'WRONG_ANSWER'
  | 'BAD_EXPLANATION'
  | 'UNCLEAR_QUESTION'
  | 'TELEMETRY_MISMATCH'
  | 'OTHER';
export type ProblemReportStatus = 'OPEN' | 'REVIEWED' | 'RESOLVED' | 'DISMISSED';
export type StatHintKey =
  | 'TRACK_STATUS'
  | 'LAP_PROGRESS'
  | 'TYRE_COMPOUND'
  | 'TYRE_AGE'
  | 'STINT_NUMBER';

// Race snapshot built on each lap completion
export interface RaceSnapshot {
  sessionId: string;
  lapNumber: number;
  totalLaps: number | null;
  trackStatus: TrackStatus;
  sessionMode: SessionMode;
  replaySpeed: number | null;
  isReplayComplete: boolean;
  drivers: DriverState[];
  timestamp: Date;
  dataFeedStalled: boolean;
  leaderLapTime: number | null;
  leaderLapStartTime: string | null;
  /**
   * Sector numbers currently under a localized (non-global) yellow flag.
   * Display-only: this NEVER affects `trackStatus`, question triggering, or
   * resolution. It exists so the HUD can reflect on-track sector cautions that
   * do not neutralize the race (which would otherwise show as plain green).
   */
  localYellowSectors: number[];
}

// OpenF1 API response types
export interface OpenF1Session {
  session_key: number;
  meeting_key: number;
  location: string;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string;
  country_key: number;
  country_code: string;
  country_name: string;
  circuit_key: number;
  circuit_short_name: string;
  year: number;
  /** Present on OpenF1 `/sessions` responses when a meeting was removed from the calendar. */
  is_cancelled?: boolean;
}

export interface SessionInfo extends OpenF1Session {
  isCompleted: boolean;
  isLive: boolean;
  isPreRace: boolean;
  mode: SessionMode;
}

export interface OpenF1Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  first_name: string;
  last_name: string;
  headshot_url: string;
  country_code: string;
  session_key: number;
  meeting_key: number;
}

export interface OpenF1Lap {
  session_key: number;
  meeting_key: number;
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  lap_time: string | null;
  is_pit_out_lap: boolean;
  date_start: string;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  segments_sector_1: number[];
  segments_sector_2: number[];
  segments_sector_3: number[];
}

export interface OpenF1Position {
  date: string;
  meeting_key: number;
  session_key: number;
  driver_number: number;
  position: number;
}

export interface OpenF1Interval {
  date: string;
  meeting_key: number;
  session_key: number;
  driver_number: number;
  gap_to_leader: number | null;
  interval: number | null;
}

export interface OpenF1Pit {
  date: string;
  session_key: number;
  meeting_key: number;
  driver_number: number;
  pit_duration: number;
  lap_number: number;
  number: number; // pit stop number
}

export interface OpenF1Stint {
  date?: string | null;
  session_key: number;
  meeting_key: number;
  driver_number: number;
  stint_number: number;
  lap_start: number | null;
  lap_end: number | null;
  compound: string | null;
  tyre_age_at_start: number | null;
}

export interface OpenF1CarData {
  date: string;
  session_key: number;
  meeting_key: number;
  driver_number: number;
  brake: number;
  drs: number;
  n_gear: number;
  rpm: number;
  speed: number;
  throttle: number;
}

export interface OpenF1RaceControl {
  date: string;
  session_key: number;
  meeting_key: number;
  category: string;
  flag: string;
  scope: string;
  sector: number;
  driver_number: number;
  message: string;
  lap_number: number;
}

// Question types
export type QuestionCategory =
  | 'OVERTAKE'
  | 'PIT_WINDOW'
  | 'GAP_CLOSING'
  | 'FINISH_POSITION';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface Question {
  id: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  template: string; // e.g., "Will {driver1} overtake {driver2} in the next {windowSize} laps?"
  windowSize: number; // Number of laps to resolve
  triggers: TriggerCondition[];
  successCondition: SuccessCondition;
  priority: number; // 1 = highest
  cooldownLaps: number; // Minimum laps between questions of this category
}

export interface TriggerCondition {
  type: string;
  params: Record<string, unknown>;
}

export interface SuccessCondition {
  type: string;
  params: Record<string, unknown>;
}

// Question instance (runtime)
export type InstanceState =
  | 'TRIGGERED'
  | 'LIVE'
  | 'LOCKED'
  | 'ACTIVE'
  | 'RESOLVED'
  | 'EXPLAINED'
  | 'CLOSED'
  | 'CANCELLED';

export interface QuestionInstanceState {
  id: string;
  lobbyId: string;
  questionId: string;
  state: InstanceState;
  triggeredAt: Date;
  lockedAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  triggerSnapshot: RaceSnapshot;
  windowSize: number;
  targetLap: number; // The lap by which we need to resolve
  answer: 'YES' | 'NO' | null;
  outcome: boolean | null;
  explanation?: string;
  cancelledReason?: string;
  cancelledAt?: Date;
  suggestedStatKeys?: StatHintKey[];
  answerDeadline?: Date; // Server-calculated deadline for accurate countdown
  // Populated for rendering
  questionText?: string;
  driver1?: DriverState;
  driver2?: DriverState;
}

// Lobby state
export interface LobbyLookupResult {
  id: string;
  code: string;
  status: 'waiting' | 'active' | 'finished';
  shareUrl: string;
}

export interface LobbyState {
  id: string;
  code: string;
  shareUrl: string;
  hostId: string;
  sessionId: string | null;
  status: 'waiting' | 'active' | 'finished';
  sessionMode: SessionMode | null;
  replaySpeed: number | null;
  isReplayComplete: boolean;
  isSimulation: boolean;
  isPublic: boolean;
  players: PlayerState[];
  currentQuestion: QuestionInstanceState | null;
  latestResolution: ResolutionEvent | null;
  questionCount: number;
  minQuestions: number;
  maxQuestions: number;
  leaderboard: LeaderboardEntryState[];
}

export interface PlayerState {
  id: string;
  username: string;
  isHost: boolean;
  connected: boolean;
  joinedAtLap?: number;
}

export type PresenceExpiryReason = 'inactive' | 'disconnected_timeout';

export interface LeaderboardEntryState {
  userId: string;
  username: string;
  points: number;
  streak: number;
  maxStreak: number;
  correctAnswers: number;
  wrongAnswers: number;
  questionsAnswered: number;
  accuracy: number;
  joinedAtLap?: number;
}

// Derived signals (used for trigger evaluation)
export interface DerivedSignals {
  closingTrend: Map<number, boolean>; // driverNumber -> isClosing
  fallingBack: Map<number, boolean>; // driverNumber -> gap to car ahead is opening
  withinOneSecond: Map<number, boolean>; // driverNumber -> within 1s of car ahead
  overtakeOpportunity: Map<number, boolean>; // driverNumber -> close and closing
  pitWindowOpen: Map<number, boolean>; // driverNumber -> inPitWindow
  tyreCliffRisk: Map<number, boolean>; // driverNumber -> atTyreCliff
  lateRacePhase: boolean;
  podiumStabilityTrend: boolean;
  closeBattles: { attacker: number; defender: number; gap: number }[];
  overtakeModeArmed: Map<number, boolean>; // driverNumber -> earned Overtake Mode this lap
  undercutPressure: Map<number, boolean>; // driverNumber -> close enough to undercut
}

// Socket event types
export interface QuestionEvent {
  instanceId: string;
  questionId: string;
  questionText: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  state: InstanceState;
  windowSize: number;
  triggeredAt: string;
  answerDeadline?: string;
  suggestedStatKeys?: StatHintKey[];
}

export interface QuestionStateEvent {
  instanceId: string;
  state: InstanceState;
  cancelledReason?: string;
  answerDeadline?: string;
}

export interface ServerErrorEvent {
  message: string;
  code?: 'SESSION_EXPIRED' | 'TRANSIENT_CONNECTION' | 'VALIDATION_ERROR' | 'FORBIDDEN' | 'UNKNOWN';
}

export interface ResolutionEvent {
  instanceId: string;
  questionId: string;
  questionText: string;
  correctAnswer: 'YES' | 'NO';
  outcome: boolean;
  explanation: string;
  scores?: ScoreUpdate[];
}

export interface CreateProblemReportInput {
  instanceId: string;
  userId: string;
  reason: ProblemReportReason;
  note?: string;
}

export interface AdminProblemReport {
  id: string;
  instanceId: string;
  userId: string;
  username: string;
  lobbyId: string;
  lobbyCode: string;
  questionId: string;
  questionText: string | null;
  correctAnswer: 'YES' | 'NO' | null;
  explanation: string | null;
  reportedAnswer: 'YES' | 'NO' | null;
  reason: ProblemReportReason;
  note: string | null;
  status: ProblemReportStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export interface ScoreUpdate {
  userId: string;
  username: string;
  points: number;
  pointsChange: number;
  streak: number;
  accuracy: number;
  answered: boolean;
  wasCorrect: boolean | null;
}

export interface RaceSnapshotEvent {
  sessionId: string;
  lapNumber: number;
  totalLaps: number | null;
  trackStatus: TrackStatus;
  sessionMode: SessionMode;
  replaySpeed: number | null;
  isReplayComplete: boolean;
  timestamp: string;
  leaderLapTime: number | null;
  leaderLapStartTime: string | null;
  leader: string;
  leaderNameSource?: 'full_name' | 'broadcast_name' | 'unknown';
  leaderTelemetryTimestamp?: string | null;
  leaderStats: LeaderStats | null;
  topThree: string[];
  dataFeedStalled: boolean;
  /** Display-only localized sector yellows (does not affect gameplay). */
  localYellowSectors: number[];
}
