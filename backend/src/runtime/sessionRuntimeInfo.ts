import type { OpenF1Session, SessionMode } from '../types';

export function toSessionInfo(session: OpenF1Session): OpenF1Session & { isCompleted: boolean; isLive: boolean; mode: SessionMode } {
  const now = Date.now();
  const start = new Date(session.date_start).getTime();
  const end = new Date(session.date_end).getTime();
  const isCompleted = end < now;
  const isLive = start <= now && now < end;
  return {
    ...session,
    isCompleted,
    isLive,
    mode: isLive ? 'live' : 'replay',
  };
}
