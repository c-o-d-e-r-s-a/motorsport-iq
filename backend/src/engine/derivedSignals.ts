import type { RaceSnapshot, DriverState, DerivedSignals } from '../types';

/**
 * Optional thresholds for relaxed signal calculation during pacing tiers.
 * Defaults match strict-mode values (tier: strict).
 */
export interface SignalOverrides {
  closingTrendThreshold?: number;
  closeBattleThreshold?: number;
  lateRacePhasePercent?: number;
  overtakeOpportunityMaxGap?: number;
  pitWindowStintLength?: number;
}

const DEFAULT_SIGNAL_OVERRIDES: Required<SignalOverrides> = {
  closingTrendThreshold: 0.1,
  closeBattleThreshold: 4.0,
  lateRacePhasePercent: 0.6,
  overtakeOpportunityMaxGap: 1.5,
  pitWindowStintLength: 18,
};

/**
 * Derived Signals - Observable, lap-based signals only for the MVP ruleset.
 */

export function isClosingTrend(currentGap: number, previousGap: number, threshold = 0.1): boolean {
  return previousGap - currentGap > threshold;
}

export function isWithinOneSecond(driver: DriverState): boolean {
  return driver.interval !== null && driver.interval <= 1.0;
}

export function isInPitWindow(driver: DriverState, expectedStintLength = 18): boolean {
  return driver.tyreAge >= expectedStintLength - 3;
}

export function isAtTyreCliff(current: DriverState, previous: DriverState | null): boolean {
  if (!previous || current.lastLapTime === null || previous.lastLapTime === null) {
    return current.tyreAge >= 25;
  }

  return current.tyreAge >= 20 && current.lastLapTime - previous.lastLapTime >= 1.0;
}

export function isLateRacePhase(snapshot: RaceSnapshot, phasePercent = 0.6): boolean {
  if (!snapshot.totalLaps || snapshot.totalLaps <= 0) {
    return false;
  }

  return snapshot.lapNumber >= Math.ceil(snapshot.totalLaps * phasePercent);
}

export function isPodiumStable(currentSnapshot: RaceSnapshot, previousSnapshot: RaceSnapshot | null): boolean {
  if (!previousSnapshot) {
    return false;
  }

  const currentTopThree = currentSnapshot.drivers.slice(0, 3);
  const previousTopThree = previousSnapshot.drivers.slice(0, 3);
  if (currentTopThree.length < 3 || previousTopThree.length < 3) {
    return false;
  }

  const sameDrivers = currentTopThree.every((driver, index) => driver.driverNumber === previousTopThree[index]?.driverNumber);
  if (!sameDrivers) {
    return false;
  }

  return currentTopThree.every((driver, index) => {
    if (index === 0) return true;
    const previousDriver = previousTopThree[index];
    if (!previousDriver || driver.interval === null || previousDriver.interval === null) {
      return false;
    }

    return Math.abs(driver.interval - previousDriver.interval) <= 0.5;
  });
}

export function getCloseBattles(
  snapshot: RaceSnapshot,
  threshold = 3.0
): { attacker: DriverState; defender: DriverState; gap: number }[] {
  const battles: { attacker: DriverState; defender: DriverState; gap: number }[] = [];

  for (const attacker of snapshot.drivers) {
    if (attacker.position <= 1 || attacker.interval === null || attacker.retired || attacker.inPit) {
      continue;
    }

    if (attacker.interval > threshold) {
      continue;
    }

    const defender = snapshot.drivers.find((driver) => driver.position === attacker.position - 1);
    if (!defender || defender.retired) {
      continue;
    }

    battles.push({ attacker, defender, gap: attacker.interval });
  }

  return battles;
}

export function isUndercutPressure(driver: DriverState, closing: boolean, pitWindow: boolean): boolean {
  if (!pitWindow || !closing || driver.inPit || driver.retired) {
    return false;
  }

  if (driver.position < 3 || driver.position > 15) {
    return false;
  }

  return driver.interval !== null && driver.interval >= 1.5 && driver.interval <= 4.5;
}

/**
 * 2026 Overtake Mode proxy: within 1s at the last detection point grants
 * extra deploy power on the following lap while chasing the same car.
 */
export function isOvertakeModeArmed(
  snapshot: RaceSnapshot,
  previousSnapshot: RaceSnapshot | null,
  driver: DriverState
): boolean {
  if (!previousSnapshot || driver.position <= 1 || driver.inPit || driver.retired) {
    return false;
  }

  const previousDriver = previousSnapshot.drivers.find(
    (candidate) => candidate.driverNumber === driver.driverNumber
  );
  if (!previousDriver || previousDriver.interval === null || previousDriver.interval > 1.0) {
    return false;
  }

  const previousCarAhead = getDriverAhead(previousSnapshot, previousDriver);
  const currentCarAhead = getDriverAhead(snapshot, driver);
  if (!previousCarAhead || !currentCarAhead) {
    return false;
  }

  return previousCarAhead.driverNumber === currentCarAhead.driverNumber;
}

export function calculateDerivedSignals(
  currentSnapshot: RaceSnapshot,
  previousSnapshot: RaceSnapshot | null,
  overrides: SignalOverrides = {}
): DerivedSignals {
  const config = { ...DEFAULT_SIGNAL_OVERRIDES, ...overrides };
  const closingTrend = new Map<number, boolean>();
  const fallingBack = new Map<number, boolean>();
  const withinOneSecond = new Map<number, boolean>();
  const overtakeOpportunity = new Map<number, boolean>();
  const pitWindowOpen = new Map<number, boolean>();
  const tyreCliffRisk = new Map<number, boolean>();
  const overtakeModeArmed = new Map<number, boolean>();
  const undercutPressure = new Map<number, boolean>();
  const closeBattles = getCloseBattles(currentSnapshot, config.closeBattleThreshold);

  for (const driver of currentSnapshot.drivers) {
    const previousDriver = previousSnapshot?.drivers.find((candidate) => candidate.driverNumber === driver.driverNumber) ?? null;
    const closing = previousDriver && driver.interval !== null && previousDriver.interval !== null
      ? isClosingTrend(driver.interval, previousDriver.interval, config.closingTrendThreshold)
      : false;
    const opening = previousDriver && driver.interval !== null && previousDriver.interval !== null
      ? isClosingTrend(previousDriver.interval, driver.interval, config.closingTrendThreshold)
      : false;
    const inPitWindow = isInPitWindow(driver, config.pitWindowStintLength);

    closingTrend.set(driver.driverNumber, closing);
    fallingBack.set(driver.driverNumber, opening);
    withinOneSecond.set(driver.driverNumber, isWithinOneSecond(driver));
    overtakeOpportunity.set(
      driver.driverNumber,
      closing && (driver.interval ?? Infinity) <= config.overtakeOpportunityMaxGap
    );
    pitWindowOpen.set(driver.driverNumber, inPitWindow);
    tyreCliffRisk.set(driver.driverNumber, isAtTyreCliff(driver, previousDriver));
    overtakeModeArmed.set(
      driver.driverNumber,
      isOvertakeModeArmed(currentSnapshot, previousSnapshot, driver)
    );
    undercutPressure.set(driver.driverNumber, isUndercutPressure(driver, closing, inPitWindow));
  }

  return {
    closingTrend,
    fallingBack,
    withinOneSecond,
    overtakeOpportunity,
    pitWindowOpen,
    tyreCliffRisk,
    lateRacePhase: isLateRacePhase(currentSnapshot, config.lateRacePhasePercent),
    podiumStabilityTrend: isPodiumStable(currentSnapshot, previousSnapshot),
    closeBattles: closeBattles.map((battle) => ({
      attacker: battle.attacker.driverNumber,
      defender: battle.defender.driverNumber,
      gap: battle.gap,
    })),
    overtakeModeArmed,
    undercutPressure,
  };
}

export function getDriverByPosition(snapshot: RaceSnapshot, position: number): DriverState | null {
  return snapshot.drivers.find((driver) => driver.position === position) ?? null;
}

export function getDriverByNumber(snapshot: RaceSnapshot, driverNumber: number): DriverState | null {
  return snapshot.drivers.find((driver) => driver.driverNumber === driverNumber) ?? null;
}

export function getDriverAhead(snapshot: RaceSnapshot, driver: DriverState): DriverState | null {
  if (driver.position <= 1) {
    return null;
  }

  return getDriverByPosition(snapshot, driver.position - 1);
}
