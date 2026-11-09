import type { Inventory } from './state';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyInfo {
  name: string;
  icon: string;
  blurb: string;
  start: Inventory;
  /** Enemy health multiplier. */
  hp: number;
  /** Damage the car takes from enemies. */
  dmg: number;
  /** Fuel burned per unit. */
  fuel: number;
  /** Space between fights (bigger is fewer fights). */
  gap: number;
  /** Score multiplier. */
  score: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyInfo> = {
  easy: {
    name: 'Sunday drive',
    icon: '🌤️',
    blurb: 'More supplies, softer enemies, fewer fights.',
    start: { fuel: 90, cash: 100, scrap: 20, bullets: 150, shells: 10, catnip: 2 },
    hp: 0.75,
    dmg: 0.6,
    fuel: 0.85,
    gap: 1.3,
    score: 0.6,
  },
  normal: {
    name: 'Road trip',
    icon: '🚗',
    blurb: 'The way it was meant to be driven.',
    start: { fuel: 70, cash: 60, scrap: 10, bullets: 100, shells: 6, catnip: 1 },
    hp: 1,
    dmg: 1,
    fuel: 1,
    gap: 1,
    score: 1,
  },
  hard: {
    name: 'Madness',
    icon: '💀',
    blurb: 'Thin supplies, tough enemies, fights around every bend.',
    start: { fuel: 60, cash: 30, scrap: 5, bullets: 60, shells: 3, catnip: 0 },
    hp: 1.3,
    dmg: 1.4,
    fuel: 1.1,
    gap: 0.8,
    score: 1.6,
  },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as Difficulty[];
