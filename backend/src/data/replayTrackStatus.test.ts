import type { DriverState, RaceSnapshot } from '../types';
import { ReplayTrackStatusController } from './replayTrackStatus';

function createSnapshot(
  drivers: Partial<DriverState>[],
  overrides: Partial<RaceSnapshot> = {}
): RaceSnapshot {
  return {
    sessionId: '11291',
    timestamp: new Date('2026-05-24T20:00:00Z'),
    lapNumber: 10,
    totalLaps: 70,
    trackStatus: 'GREEN',
    sessionMode: 'replay',
    replaySpeed: 10,
    dataFeedStalled: false,
    isReplayComplete: false,
    leaderLapTime: 85,
    leaderLapStartTime: null,
    globalYellowActive: false,
    localYellowSectors: [],
    drivers: drivers.map((driver, index) => ({
      driverNumber: driver.driverNumber ?? index + 1,
      position: driver.position ?? index + 1,
      name: driver.name ?? `Driver ${index + 1}`,
      team: driver.team ?? 'Team',
      gap: driver.gap ?? index * 1.5,
      interval: driver.interval ?? 1.5,
      lastLapTime: driver.lastLapTime ?? 85,
      tyreCompound: driver.tyreCompound ?? 'MEDIUM',
      tyreAge: driver.tyreAge ?? 5,
      stintNumber: driver.stintNumber ?? 1,
      overtakeModeArmed: driver.overtakeModeArmed ?? false,
      pitCount: driver.pitCount ?? 0,
      inPit: driver.inPit ?? false,
      retired: driver.retired ?? false,
    })),
    ...overrides,
  };
}

function greenFieldSnapshot(lapTime = 85): RaceSnapshot {
  return createSnapshot(
    Array.from({ length: 10 }, (_, index) => ({
      driverNumber: index + 1,
      position: index + 1,
      lastLapTime: lapTime + (index % 2 === 0 ? 0.2 : -0.2),
    }))
  );
}

function slowFieldSnapshot(lapTime: number): RaceSnapshot {
  return createSnapshot(
    Array.from({ length: 10 }, (_, index) => ({
      driverNumber: index + 1,
      position: index + 1,
      lastLapTime: lapTime + (index % 2 === 0 ? 0.5 : -0.5),
    }))
  );
}

describe('ReplayTrackStatusController', () => {
  it('ignores safety car line steward messages in chronological replay processing', () => {
    const controller = new ReplayTrackStatusController();

    const status = controller.processMessages([
      {
        date: '2026-05-24T20:12:54+00:00',
        session_key: 11291,
        meeting_key: 1285,
        category: 'Other',
        flag: '',
        scope: '',
        sector: 0,
        driver_number: 0,
        message: 'INCIDENT INVOLVING CARS 77 (BOT) AND 18 (STR) NOTED - STARTING PROCEDURE INFRINGEMENT - OUT OF POSITION AT SAFETY CAR LINE',
        lap_number: 3,
      },
    ]);

    expect(status).toBeNull();
    expect(controller.getStatus()).toBe('GREEN');
  });

  it('applies real VSC deployment and track clear transitions in order', () => {
    const controller = new ReplayTrackStatusController();

    expect(controller.processMessages([
      {
        date: '2026-05-24T20:48:25+00:00',
        session_key: 11291,
        meeting_key: 1285,
        category: 'SafetyCar',
        flag: '',
        scope: '',
        sector: 0,
        driver_number: 0,
        message: 'VSC DEPLOYED',
        lap_number: 31,
      },
    ])).toBe('VSC');

    expect(controller.processMessages([
      {
        date: '2026-05-24T20:51:45+00:00',
        session_key: 11291,
        meeting_key: 1285,
        category: 'Flag',
        flag: 'GREEN',
        scope: 'Track',
        sector: 0,
        driver_number: 0,
        message: 'TRACK CLEAR',
        lap_number: 32,
      },
    ])).toBe('GREEN');
  });

  it('clears a false SC when green lap pace persists for multiple laps', () => {
    const controller = new ReplayTrackStatusController();

    controller.processMessages([
      {
        date: '2026-05-24T20:00:00+00:00',
        session_key: 11291,
        meeting_key: 1285,
        category: 'SafetyCar',
        flag: '',
        scope: '',
        sector: 0,
        driver_number: 0,
        message: 'SAFETY CAR DEPLOYED',
        lap_number: 3,
      },
    ]);

    for (let lap = 1; lap <= 3; lap += 1) {
      controller.onLapComplete(greenFieldSnapshot(85));
    }

    expect(controller.getStatus()).toBe('GREEN');
    expect(controller.onLapComplete(greenFieldSnapshot(85))).toBeNull();
  });

  it('keeps a real VSC when lap pace slows enough', () => {
    const controller = new ReplayTrackStatusController();

    for (let lap = 1; lap <= 3; lap += 1) {
      controller.onLapComplete(greenFieldSnapshot(85));
    }

    controller.processMessages([
      {
        date: '2026-05-24T20:48:25+00:00',
        session_key: 11291,
        meeting_key: 1285,
        category: 'SafetyCar',
        flag: '',
        scope: '',
        sector: 0,
        driver_number: 0,
        message: 'VSC DEPLOYED',
        lap_number: 31,
      },
    ]);

    expect(controller.onLapComplete(slowFieldSnapshot(98))).toBeNull();
    expect(controller.getStatus()).toBe('VSC');
  });
});
