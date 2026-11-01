import { DIFFICULTIES, type Difficulty } from './difficulty';
import type { GameState } from './state';

export interface ScoreEntry {
  score: number;
  route: string;
  difficulty: Difficulty;
  won: boolean;
  /** ISO date. */
  date: string;
}

export interface ScoreBreakdown {
  total: number;
  lines: [string, number][];
}

/**
 * Points for distance, kills and bosses, plus a finish bonus for the car's
 * condition and leftover cash, all scaled by difficulty.
 */
export function scoreFor(s: GameState, pathLength: number): ScoreBreakdown {
  const won = s.status === 'won';
  const lines: [string, number][] = [
    ['Distance', Math.round((Math.min(s.distance, pathLength) / pathLength) * 1000)],
    ['Enemies taken down', s.kills * 10],
    ['Bosses beaten', s.bossesBeaten * 300],
  ];
  if (won) {
    lines.push(['Made it!', 500]);
    lines.push(['Car condition', Math.round(s.health) * 3]);
    lines.push(['Cash left', Math.round(s.inv.cash)]);
  }
  const base = lines.reduce((a, [, v]) => a + v, 0);
  const mult = DIFFICULTIES[s.difficulty].score;
  if (mult !== 1) lines.push([`${DIFFICULTIES[s.difficulty].name} ×${mult}`, Math.round(base * mult) - base]);
  return { total: Math.round(base * mult), lines };
}

const KEY = 'rtm-scores';
export const MAX_SCORES = 10;

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as ScoreEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Adds a score and returns its rank (0-based), or -1 if it didn't make the list. */
export function addScore(entry: ScoreEntry, list = loadScores()): { list: ScoreEntry[]; rank: number } {
  const next = [...list, entry].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
  const rank = next.indexOf(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: scores just don't persist */
  }
  return { list: next, rank };
}
