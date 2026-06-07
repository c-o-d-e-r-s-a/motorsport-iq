import * as signalR from '@microsoft/signalr';

import {
  F1_LIVE_TIMING_TOPICS,
  F1SignalRClient,
  type F1SignalRClientOptions,
} from './f1SignalRClient';

const SIGNALR_CORE_URL = 'https://livetiming.formula1.com/signalrcore';
const F1_LIVE_TIMING_TOKEN = process.env.F1_LIVE_TIMING_TOKEN?.trim() ?? '';

export function hasF1LiveTimingToken(): boolean {
  return F1_LIVE_TIMING_TOKEN.length > 0;
}

function parseFeedPayload(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function processInitialSnapshot(
  processor: F1SignalRClient,
  snapshot: unknown
): void {
  if (!snapshot || typeof snapshot !== 'object') {
    return;
  }

  for (const [topic, payload] of Object.entries(snapshot)) {
    processor.processFeedMessage(topic, parseFeedPayload(payload));
  }
}

export class F1SignalRCoreClient {
  private connection: signalR.HubConnection | null = null;
  private intentionallyClosed = false;
  private reconnectAttempts = 0;
  private readonly processor: F1SignalRClient;

  constructor(private readonly options: F1SignalRClientOptions = {}) {
    // Reuse the existing topic decoders/handlers from the legacy WebSocket client.
    this.processor = new F1SignalRClient(options);
  }

  async start(): Promise<void> {
    this.intentionallyClosed = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.intentionallyClosed = true;
    if (this.connection) {
      try {
        await this.connection.stop();
      } catch {
        /* ignore */
      }
      this.connection = null;
    }
  }

  private async connect(): Promise<void> {
    try {
      const cookie = await this.fetchAwsAlbCookie();
      const connectionOptions: signalR.IHttpConnectionOptions = {
        headers: cookie ? { Cookie: cookie } : undefined,
      };

      if (hasF1LiveTimingToken()) {
        connectionOptions.accessTokenFactory = () => F1_LIVE_TIMING_TOKEN;
      }

      this.connection = new signalR.HubConnectionBuilder()
        .withUrl(SIGNALR_CORE_URL, connectionOptions)
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .build();

      this.connection.on('feed', (topic: string, payload: unknown) => {
        this.processor.processFeedMessage(topic, parseFeedPayload(payload));
      });

      this.connection.onreconnecting(() => {
        console.warn('[SignalR Core] Connection unstable. Monitoring...');
        this.options.onConnectionLoss?.();
      });

      this.connection.onreconnected(async () => {
        console.log('[SignalR Core] Connection restored. Re-subscribing...');
        this.reconnectAttempts = 0;
        try {
          const snapshot = await this.connection?.invoke<Record<string, unknown>>(
            'Subscribe',
            F1_LIVE_TIMING_TOPICS
          );
          processInitialSnapshot(this.processor, snapshot);
        } catch (error) {
          console.error('[SignalR Core] Re-subscribe failed after reconnect:', error);
        }
        this.options.onConnectionRestored?.();
      });

      this.connection.onclose((error) => {
        if (this.intentionallyClosed) {
          return;
        }

        console.warn('[SignalR Core] Connection closed.', error?.message ?? '');
        this.scheduleReconnect();
      });

      await this.connection.start();
      this.reconnectAttempts = 0;
      console.log('[SignalR Core] WebSocket connected. Subscribing to F1 topics...');

      const initialSnapshot = await this.connection.invoke<Record<string, unknown>>(
        'Subscribe',
        F1_LIVE_TIMING_TOPICS
      );
      processInitialSnapshot(this.processor, initialSnapshot);
      this.options.onConnectionRestored?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SignalR Core] connect() failed:', message);
      this.scheduleReconnect();
      throw error;
    }
  }

  private async fetchAwsAlbCookie(): Promise<string> {
    try {
      const response = await fetch(SIGNALR_CORE_URL, { method: 'OPTIONS' });
      const setCookie = response.headers.get('set-cookie') ?? '';
      const cookies = setCookie
        .split(/,(?=[^;]+=)/)
        .map((entry) => entry.split(';')[0].trim())
        .filter((entry) => entry.startsWith('AWSALB'));

      return cookies.join('; ');
    } catch (error) {
      console.warn('[SignalR Core] Failed to prefetch AWSALB cookie:', error);
      return '';
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 5) {
      console.error('[SignalR Core] Giving up after 5 reconnect attempts.');
      this.options.onConnectionClosedPermanently?.();
      return;
    }

    const delay = Math.min(30000, 2000 * 2 ** (this.reconnectAttempts - 1));
    console.log(`[SignalR Core] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/5)...`);
    this.options.onConnectionLoss?.();

    setTimeout(() => {
      if (!this.intentionallyClosed) {
        void this.connect();
      }
    }, delay);
  }
}
