import { OpenF1Client } from '../data/openf1Client';
import { SnapshotStore } from '../data/snapshotStore';
import type {
  OpenF1Lap,
  OpenF1Session,
  RaceSnapshot,
  SessionMode,
} from '../types';
import type { ReplayEvent } from './replayTimeline';

export interface RuntimeCallbacks {
  onSnapshotUpdate: (snapshot: RaceSnapshot, lobbyIds: Set<string>) => void;
  onLapComplete: (snapshot: RaceSnapshot, lobbyIds: Set<string>) => Promise<void>;
  onFeedStall: (stalled: boolean, lobbyIds: Set<string>) => void;
  onReplayComplete: (snapshot: RaceSnapshot | null, lobbyIds: Set<string>) => Promise<void>;
  onError: (error: Error) => void;
}

export interface SessionRuntime {
  sessionId: string;
  mode: SessionMode;
  replaySpeed: number | null;
  addLobby(lobbyId: string): void;
  removeLobby(lobbyId: string): void;
  getLobbyIds(): Set<string>;
  getCurrentSnapshot(): RaceSnapshot | null;
  getPreviousSnapshot(): RaceSnapshot | null;
  start(): Promise<void>;
  stop(): void;
  pause?(): void;
  resume?(): void;
  isPausedState?(): boolean;
}

export function cloneLobbyIds(source: Set<string>): Set<string> {
  return new Set(source);
}

export function computeReplayEventDelayMs(
  currentEvent: ReplayEvent,
  nextEvent: ReplayEvent,
  playbackSpeed: number
): number {
  return Math.max(0, Math.round((nextEvent.timestamp - currentEvent.timestamp) / playbackSpeed));
}

export abstract class BaseRuntime implements SessionRuntime {
  readonly sessionId: string;
  readonly mode: SessionMode;
  readonly replaySpeed: number | null;
  protected readonly session: OpenF1Session;
  protected readonly callbacks: RuntimeCallbacks;
  protected readonly lobbyIds = new Set<string>();
  protected readonly client: OpenF1Client;
  protected readonly snapshotStore: SnapshotStore;
  protected started = false;

  constructor(session: OpenF1Session, mode: SessionMode, replaySpeed: number | null, callbacks: RuntimeCallbacks) {
    this.session = session;
    this.mode = mode;
    this.replaySpeed = replaySpeed;
    this.callbacks = callbacks;
    this.sessionId = String(session.session_key);

    this.client = new OpenF1Client({
      onLapCompletion: (lap) => this.handleLapCompletion(lap),
      onPositionUpdate: (positions) => this.snapshotStore.processPositionUpdate(positions),
      onIntervalUpdate: (intervals) => this.snapshotStore.processIntervalUpdate(intervals),
      onPitUpdate: (pits) => this.snapshotStore.processPitUpdate(pits),
      onStintUpdate: (stints) => this.snapshotStore.processStintUpdate(stints),
      onRaceControlUpdate: (messages) => this.snapshotStore.processRaceControlUpdate(messages),
      onFeedStall: (stalled) => {
        this.snapshotStore.handleFeedStall(stalled);
        this.callbacks.onFeedStall(stalled, cloneLobbyIds(this.lobbyIds));
      },
      onError: (error) => this.callbacks.onError(error),
    });

    this.snapshotStore = new SnapshotStore(this.client, {
      onSnapshotUpdate: (snapshot) => {
        this.callbacks.onSnapshotUpdate(snapshot, cloneLobbyIds(this.lobbyIds));
      },
      onLapComplete: async (snapshot) => {
        await this.callbacks.onLapComplete(snapshot, cloneLobbyIds(this.lobbyIds));
      },
    });
  }

  addLobby(lobbyId: string): void {
    this.lobbyIds.add(lobbyId);
  }

  removeLobby(lobbyId: string): void {
    this.lobbyIds.delete(lobbyId);
    if (this.lobbyIds.size === 0) {
      this.stop();
    }
  }

  getLobbyIds(): Set<string> {
    return cloneLobbyIds(this.lobbyIds);
  }

  getCurrentSnapshot(): RaceSnapshot | null {
    return this.snapshotStore.getCurrentSnapshot();
  }

  getPreviousSnapshot(): RaceSnapshot | null {
    return this.snapshotStore.getPreviousSnapshot();
  }

  protected async handleLapCompletion(lap: OpenF1Lap): Promise<void> {
    this.snapshotStore.processLapCompletion(lap);
  }

  abstract start(): Promise<void>;
  abstract stop(): void;
}
