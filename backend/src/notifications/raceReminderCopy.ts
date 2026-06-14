import type { OpenF1Session } from '../types';

export interface RaceReminderMessage {
  title: string;
  body: string;
}

const RACE_REMINDER_COPY_BY_SESSION_KEY: Record<number, RaceReminderMessage> = {
  11299: {
    title: 'Monaco GP — 30 minutes to chaos',
    body: 'Narrow streets. Big egos. Zero margin. Jump in and predict who blinks first before the yachts start judging.',
  },
  11307: {
    title: 'Spanish GP — lights out in 30',
    body: 'Catalunya is about tyre life and late-braking bravery. Think you can read the race better than the pit wall?',
  },
  11315: {
    title: 'Austrian GP — 30 min countdown',
    body: 'Red Bull Ring rewards the bold. Join Motorsport IQ and call the moves before Turn 1 gets spicy.',
  },
  11326: {
    title: 'British GP — tea break over, race on',
    body: 'Silverstone wind, wheel-to-wheel madness, and rain that appears from nowhere. Perfect time to join and play live.',
  },
  11334: {
    title: 'Belgian GP — Spa in 30 minutes',
    body: 'Eau Rouge. Weather roulette. Championship swings. Get in the lobby now — your predictions are waiting at the bus stop.',
  },
  11342: {
    title: 'Hungarian GP — 30 to green',
    body: 'Hungaroring is a chess match at 200 mph. Outsmart everyone else with live race predictions before the first pit drama.',
  },
  11353: {
    title: 'Dutch GP — orange army assembling',
    body: 'Zandvoort banking, beach vibes, and fearless overtakes. Join now and prove you saw the strategy before it happened.',
  },
  11361: {
    title: 'Italian GP — Monza in 30',
    body: 'Temple of Speed. Slipstream wars. National anthem volume: illegal. Jump in and predict like you own the main straight.',
  },
  11369: {
    title: 'Madrid GP — 30 minutes out',
    body: 'New circuit energy. Old-school F1 drama. Be the friend who called the upset before lap 10.',
  },
  11377: {
    title: 'Baku GP — lights out soon',
    body: 'Castle walls, long straights, and one questionable castle section. Join Motorsport IQ before someone hits the wall. Again.',
  },
  11388: {
    title: 'Singapore GP — 30 min to night race',
    body: 'Street lights on. Humidity up. Brain speed required. Get in now — this race punishes guesswork and rewards instinct.',
  },
  11396: {
    title: 'US GP — Austin countdown: 30',
    body: 'COTA esses, American crowd noise, and late-race strategy chaos. Your live prediction streak starts in half an hour.',
  },
  11404: {
    title: 'Mexico GP — 30 minutes to altitude',
    body: 'Thin air, thick drama, stadium section roaring. Join the lobby and predict who survives the altitude and the pressure.',
  },
  11412: {
    title: 'Brazil GP — Interlagos in 30',
    body: 'If it rains, forget everything you thought you knew. Join now and ride the chaos lap by lap with live predictions.',
  },
  11420: {
    title: 'Las Vegas GP — 30 min to lights',
    body: 'Neon, night racing, and one very expensive wall. Jump in before the strip turns into a strategy thriller.',
  },
  11428: {
    title: 'Qatar GP — 30 minutes to green',
    body: 'Desert heat, tyre nightmares, and late-race surprises. Get in early and call the race before the paddock does.',
  },
  11436: {
    title: 'Abu Dhabi GP — season finale in 30',
    body: 'Championship fireworks under the Yas Marina lights. Join Motorsport IQ and finish the season with bragging rights.',
  },
};

function buildGenericRaceReminder(session: OpenF1Session): RaceReminderMessage {
  const grandPrixName = session.country_name || session.location;

  return {
    title: `${grandPrixName} GP — 30 minutes to lights out`,
    body: `The grid is forming at ${session.circuit_short_name}. Join Motorsport IQ now and predict live before your mates do.`,
  };
}

export function buildRaceReminderMessage(session: OpenF1Session): RaceReminderMessage {
  return RACE_REMINDER_COPY_BY_SESSION_KEY[session.session_key] ?? buildGenericRaceReminder(session);
}
