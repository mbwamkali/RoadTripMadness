/** Car upgrades bought at garages with scrap and cash. Each has three levels. */
export type UpgradeKind = 'armor' | 'tank' | 'engine' | 'turret' | 'ram';

export type Upgrades = Record<UpgradeKind, number>;

export const MAX_LEVEL = 3;

export const UPGRADES: Record<UpgradeKind, { name: string; icon: string; describe: (level: number) => string }> = {
  armor: { name: 'Armor plating', icon: '🛡️', describe: (l) => `Car condition up to ${100 + l * 25}` },
  tank: { name: 'Long-range tank', icon: '🛢️', describe: (l) => `Holds ${100 + l * 30} fuel` },
  engine: { name: 'Engine tune-up', icon: '⚙️', describe: (l) => `Uses ${l * 12}% less fuel, top speed +${l * 5} mph` },
  turret: { name: 'Roof turret', icon: '🎯', describe: (l) => `Machine gun hits ${Math.round((1 + l * 0.35) * 100)}% as hard` },
  ram: { name: 'Ram plate', icon: '🐏', describe: (l) => (l === 0 ? 'Zombies dent the car' : `Zombie hits cost ${Math.max(0, 6 - l * 2)} condition`) },
};

export const noUpgrades = (): Upgrades => ({ armor: 0, tank: 0, engine: 0, turret: 0, ram: 0 });

export function upgradeCost(level: number): { scrap: number; cash: number } {
  return [
    { scrap: 12, cash: 20 },
    { scrap: 24, cash: 45 },
    { scrap: 40, cash: 80 },
  ][Math.min(level, 2)];
}

export const maxHealthFor = (u: Upgrades) => 100 + u.armor * 25;
export const tankFor = (u: Upgrades) => 100 + u.tank * 30;
export const fuelEfficiency = (u: Upgrades) => 1 - u.engine * 0.12;
export const gunDamageFor = (u: Upgrades) => 1 + u.turret * 0.35;
export const ramDamageFor = (u: Upgrades) => Math.max(0, 6 - u.ram * 2);
