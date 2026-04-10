'use client';

import { io, Socket } from 'socket.io-client';
import { resolveBackendUrl } from './backendUrl';
import type {
  LobbyState,
  PresenceExpiryReason,
  QuestionEvent,
  QuestionStateEvent,
  ResolutionEvent,
  LeaderboardEntry,
  RaceSnapshotEvent,
  ServerErrorEvent,
  SessionInfo,
  StatHintKey,
} from './types';
import { SERVER_EVENTS, CLIENT_EVENTS } from './types';

const SOCKET_URL = resolveBackendUrl();

type Listener = (data: unknown) => void;
type ConnectionError = { message: string };

class SocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<Listener>> = new Map();
  private lastError: ConnectionError | null = null;

  connect(): Socket {
    if (this.socket) {
      if (!this.socket.connected) {
        this.socket.connect();
      }
      return this.socket;
    }

    this.socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    this.setupEventHandlers();
    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.lastError = null;
      this.emit('connected', undefined);
    });

    this.socket.on('disconnect', (reason: string) => {
      this.emit('disconnected', { reason });
      this.emit('reconnecting', { reason });
    });

    this.socket.on('connect_error', (error: Error & { description?: unknown }) => {
      if (this.socket?.connected) {
        return;
      }

      const details = typeof error.description === 'string'
        ? error.description
        : error.message;
      const normalizedDetails = details.toLowerCase();

      if (normalizedDetails.includes('websocket') || normalizedDetails.includes('transport')) {
        this.emit('reconnecting', { reason: 'transport_upgrade_failed' });
        return;
      }

      this.lastError = {
        message: details
          ? `Connection failed: ${details}`
          : 'Connection failed. The live game server may be unavailable.',
      };
      this.emit('connection_error', this.lastError);
    });

    this.socket.io.on('reconnect_attempt', (attempt: number) => {
      this.emit('reconnecting', { attempt });
    });

    this.socket.io.on('reconnect_failed', () => {
      const message = 'Unable to reconnect to the live game server.';
      this.lastError = { message };
      this.emit('connection_error', { message });
    });

    this.socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
      this.emit(SERVER_EVENTS.LOBBY_STATE, state);
    });

    this.socket.on(SERVER_EVENTS.QUESTION_EVENT, (event: QuestionEvent) => {
      this.emit(SERVER_EVENTS.QUESTION_EVENT, event);
    });

    this.socket.on(SERVER_EVENTS.QUESTION_STATE, (data: QuestionStateEvent) => {
      this.emit(SERVER_EVENTS.QUESTION_STATE, data);
    });

    this.socket.on(SERVER_EVENTS.QUESTION_LOCKED, (data: { instanceId: string }) => {
      this.emit(SERVER_EVENTS.QUESTION_LOCKED, data);
    });

    this.socket.on(SERVER_EVENTS.QUESTION_CANCELLED, (data: { instanceId: string; reason: string }) => {
      this.emit(SERVER_EVENTS.QUESTION_CANCELLED, data);
    });

    this.socket.on(SERVER_EVENTS.QUESTION_TEXT_UPDATE, (data: { instanceId: string; questionText: string; suggestedStatKeys?: StatHintKey[] }) => {
      this.emit(SERVER_EVENTS.QUESTION_TEXT_UPDATE, data);
    });

    this.socket.on(SERVER_EVENTS.RESOLUTION_EVENT, (event: ResolutionEvent) => {
      this.emit(SERVER_EVENTS.RESOLUTION_EVENT, event);
    });

    this.socket.on(SERVER_EVENTS.LEADERBOARD_UPDATE, (leaderboard: LeaderboardEntry[]) => {
      this.emit(SERVER_EVENTS.LEADERBOARD_UPDATE, leaderboard);
    });

    this.socket.on(SERVER_EVENTS.RACE_SNAPSHOT_UPDATE, (snapshot: RaceSnapshotEvent) => {
      this.emit(SERVER_EVENTS.RACE_SNAPSHOT_UPDATE, snapshot);
    });

    this.socket.on(SERVER_EVENTS.SESSION_STARTED, (data: { sessionId: string }) => {
      this.emit(SERVER_EVENTS.SESSION_STARTED, data);
    });

    this.socket.on(SERVER_EVENTS.PLAYER_JOINED, (data: { userId: string; username: string }) => {
      this.emit(SERVER_EVENTS.PLAYER_JOINED, data);
    });

    this.socket.on(SERVER_EVENTS.PLAYER_LEFT, (data: { userId: string }) => {
      this.emit(SERVER_EVENTS.PLAYER_LEFT, data);
    });

    this.socket.on(SERVER_EVENTS.PLAYER_DISCONNECTED, (data: { userId: string }) => {
      this.emit(SERVER_EVENTS.PLAYER_DISCONNECTED, data);
    });

    this.socket.on(SERVER_EVENTS.ANSWER_RECEIVED, (data: { instanceId: string }) => {
      this.emit(SERVER_EVENTS.ANSWER_RECEIVED, data);
    });

    this.socket.on(SERVER_EVENTS.SESSIONS_LIST, (sessions: SessionInfo[]) => {
      this.emit(SERVER_EVENTS.SESSIONS_LIST, sessions);
    });

    this.socket.on(SERVER_EVENTS.FEED_STATUS, (data: { stalled: boolean }) => {
      this.emit(SERVER_EVENTS.FEED_STATUS, data);
    });

    this.socket.on(SERVER_EVENTS.PRESENCE_EXPIRED, (data: { reason: PresenceExpiryReason }) => {
      this.emit(SERVER_EVENTS.PRESENCE_EXPIRED, data);
    });

    this.socket.on(SERVER_EVENTS.ERROR, (error: ServerErrorEvent) => {
      this.lastError = error;
      this.emit(SERVER_EVENTS.ERROR, error);
    });
  }

  on<T>(event: string, callback: (data: T) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const typedCallback = callback as unknown as Listener;
    this.listeners.get(event)?.add(typedCallback);

    return () => {
      this.listeners.get(event)?.delete(typedCallback);
    };
  }

  private emit<T>(event: string, data: T): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;

    callbacks.forEach((callback) => callback(data));
  }

  createLobby(username: string, sessionId?: string): void {
    this.socket?.emit(CLIENT_EVENTS.CREATE_LOBBY, { username, sessionId });
  }

  joinLobby(lobbyCode: string, username: string): void {
    this.socket?.emit(CLIENT_EVENTS.JOIN_LOBBY, { lobbyCode, username });
  }

  startSession(lobbyId: string, sessionId: string, userId?: string | null): void {
    this.socket?.emit(CLIENT_EVENTS.START_SESSION, { lobbyId, sessionId, userId });
  }

  submitAnswer(instanceId: string, answer: 'YES' | 'NO'): void {
    this.socket?.emit(CLIENT_EVENTS.SUBMIT_ANSWER, { instanceId, answer });
  }

  reconnectLobby(userId: string): void {
    this.socket?.emit(CLIENT_EVENTS.RECONNECT_LOBBY, { userId });
  }

  getSessions(year?: number): void {
    this.socket?.emit(CLIENT_EVENTS.GET_SESSIONS, { year });
  }

  leaveLobby(): void {
    this.socket?.emit(CLIENT_EVENTS.LEAVE_LOBBY);
  }

  sendPresencePing(): void {
    this.socket?.emit(CLIENT_EVENTS.PRESENCE_PING);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  getResolvedUrl(): string {
    return SOCKET_URL;
  }

  getLastError(): ConnectionError | null {
    return this.lastError;
  }
}

let socketClient: SocketClient | null = null;

export function getSocketClient(): SocketClient {
  if (!socketClient) {
    socketClient = new SocketClient();
  }
  return socketClient;
}

export default SocketClient;
