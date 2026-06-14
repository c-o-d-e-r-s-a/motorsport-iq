export interface PublicLobbyAutoStartSchedulerOptions {
  sweepIntervalMs?: number;
  onSweep: () => Promise<void>;
  onSweepError?: (error: unknown) => void;
}

const DEFAULT_SWEEP_INTERVAL_MS = 15_000;

export class PublicLobbyAutoStartScheduler {
  private readonly sweepIntervalMs: number;
  private readonly onSweep: PublicLobbyAutoStartSchedulerOptions['onSweep'];
  private readonly onSweepError?: PublicLobbyAutoStartSchedulerOptions['onSweepError'];
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(options: PublicLobbyAutoStartSchedulerOptions) {
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.onSweep = options.onSweep;
    this.onSweepError = options.onSweepError;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    void this.runSweep('startup');
    this.timer = setInterval(() => {
      void this.runSweep('interval');
    }, this.sweepIntervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private async runSweep(trigger: 'startup' | 'interval'): Promise<void> {
    if (this.sweeping) {
      return;
    }

    this.sweeping = true;
    try {
      await this.onSweep();
    } catch (error) {
      this.onSweepError?.(error);
      console.error(`[PublicLobby] ${trigger} auto-start sweep failed:`, error);
    } finally {
      this.sweeping = false;
    }
  }
}
