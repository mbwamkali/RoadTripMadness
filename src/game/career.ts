/**
 * What carries over from one trip to the next: the car's upgrades and the
 * threat level. Each trip you finish keeps your upgrades and raises the
 * threat: enemies get more health, hit harder and come in bigger groups.
 * A lost trip changes nothing. Saved on the device only.
 */

import { BOSSES, type BossKind } from './combat';
import { MAX_LEVEL, noUpgrades, UPGRADES, type UpgradeKind, type Upgrades } from './upgrades';
import { testing } from './testFlag';

const KEY = 'rtm-career';
/** Kid mode stops the threat from climbing past this. */
export const KID_THREAT_CAP = 2;

export interface Career {
  upgrades: Upgrades;
  threat: number;
  /** Trips finished. */
  wins: number;
  /** The halfway boss of the last trip started, so the next one is different. */
  lastBoss?: BossKind;
}

export const freshCareer = (): Career => ({ upgrades: noUpgrades(), threat: 0, wins: 0 });

function clean(c: Partial<Career> | null): Career {
  const out = freshCareer();
  if (!c || typeof c !== 'object') return out;
  for (const k of Object.keys(UPGRADES) as UpgradeKind[]) {
    const v = Number(c.upgrades?.[k]);
    out.upgrades[k] = Number.isFinite(v) ? Math.max(0, Math.min(MAX_LEVEL, Math.floor(v))) : 0;
  }
  out.threat = Math.max(0, Math.floor(Number(c.threat) || 0));
  out.wins = Math.max(0, Math.floor(Number(c.wins) || 0));
  if (c.lastBoss && BOSSES.includes(c.lastBoss)) out.lastBoss = c.lastBoss;
  return out;
}

export function loadCareer(): Career {
  try {
    return clean(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return freshCareer();
  }
}

export function saveCareer(c: Career): void {
  if (testing.on) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Storage blocked: the carry-over lasts for this visit only.
  }
}

/** The threat a new trip starts at (capped in kid mode). */
export const threatFor = (c: Career, kid: boolean) => (kid ? Math.min(c.threat, KID_THREAT_CAP) : c.threat);

/**
 * After a trip: a win keeps the car's upgrades (never lower than before) and
 * raises the threat by one; kid mode holds it at the cap. A loss keeps things as they were.
 */
export function afterTrip(c: Career, won: boolean, upgrades: Upgrades, kid: boolean): Career {
  if (!won) return c;
  const kept = { ...c.upgrades };
  for (const k of Object.keys(kept) as UpgradeKind[]) kept[k] = Math.max(kept[k], upgrades[k] ?? 0);
  const threat = kid ? Math.min(c.threat + 1, Math.max(c.threat, KID_THREAT_CAP)) : c.threat + 1;
  return { ...c, upgrades: kept, threat, wins: c.wins + 1 };
}

/** How much tougher enemies are at a threat level. */
export function threatScale(threat: number): { hp: number; dmg: number; extra: number } {
  const t = Math.max(0, threat);
  return { hp: 1 + 0.2 * t, dmg: 1 + 0.12 * t, extra: Math.min(8, 2 * t) };
}

/** Bonus points for winning at a higher threat. */
export const threatScoreBonus = (threat: number) => Math.max(0, threat) * 0.1;
