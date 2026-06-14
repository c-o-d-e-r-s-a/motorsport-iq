import supabase from '../db/supabaseClient';
import { getCalendarSessions } from '../data/f1Calendar';
import { getPublicAppOrigin } from '../lobby/shareUrl';
import type { OpenF1Session } from '../types';
import { metrics } from '../observability/metrics';
import { buildRaceReminderMessage } from './raceReminderCopy';
import { broadcastPushNotification, isPushEnabled } from './pushManager';
import {
  getUpcomingGrandPrixRaces,
  shouldSendRaceReminder,
} from './raceReminderLogic';

const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

export interface RaceReminderSchedulerOptions {
  sweepIntervalMs?: number;
  getSessions?: (year: number) => OpenF1Session[];
  now?: () => number;
  onSweepError?: (error: unknown) => void;
}

async function hasReminderBeenSent(sessionKey: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('race_reminder_sent')
    .select('session_key')
    .eq('session_key', sessionKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function markReminderSent(sessionKey: number): Promise<void> {
  const { error } = await supabase
    .from('race_reminder_sent')
    .upsert({ session_key: sessionKey, sent_at: new Date().toISOString() });

  if (error) {
    throw error;
  }
}

async function sendRaceReminder(session: OpenF1Session): Promise<void> {
  const copy = buildRaceReminderMessage(session);
  const appOrigin = getPublicAppOrigin(process.env.CORS_ORIGIN);

  await broadcastPushNotification({
    title: copy.title,
    body: copy.body,
    tag: `race-reminder-${session.session_key}`,
    url: appOrigin,
  });

  metrics.incrementCounter('push.race_reminder_sent_total');
  console.log(
    `[RaceReminder] Sent 30-min alert for ${session.location} GP (session=${session.session_key})`
  );
}

export class RaceReminderScheduler {
  private readonly sweepIntervalMs: number;
  private readonly getSessions: (year: number) => OpenF1Session[];
  private readonly now: () => number;
  private readonly onSweepError?: RaceReminderSchedulerOptions['onSweepError'];
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(options: RaceReminderSchedulerOptions = {}) {
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.getSessions = options.getSessions ?? getCalendarSessions;
    this.now = options.now ?? Date.now;
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

  async runSweep(trigger: 'startup' | 'interval'): Promise<void> {
    if (this.sweeping) {
      return;
    }

    if (!isPushEnabled()) {
      return;
    }

    this.sweeping = true;
    try {
      const now = this.now();
      const year = new Date(now).getFullYear();
      const upcomingRaces = getUpcomingGrandPrixRaces(year, now, this.getSessions);

      for (const session of upcomingRaces) {
        if (!shouldSendRaceReminder(session, now)) {
          continue;
        }

        if (await hasReminderBeenSent(session.session_key)) {
          continue;
        }

        await sendRaceReminder(session);
        await markReminderSent(session.session_key);
      }
    } catch (error) {
      this.onSweepError?.(error);
      console.error(`[RaceReminder] ${trigger} sweep failed:`, error);
    } finally {
      this.sweeping = false;
    }
  }
}
