/**
 * Graphics quality: Low, Medium or High, picked automatically for the device
 * unless the player chooses one in the pause menu. Stored on the device.
 */
export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityChoice = QualityLevel | 'auto';

export interface QualityProfile {
  /** Highest device pixel ratio the renderer will use. */
  pixelRatio: number;
  /** The sun casts shadows around the car. */
  shadows: boolean;
  /** Shadow map size in pixels. */
  shadowSize: number;
  /** Multiplies how far ahead scenery is built and how far the fog sits. */
  drawScale: number;
  /** Multiplies how many plants and rocks line the road. */
  density: number;
  /** Glow on bright things (sun, headlights, explosions). */
  bloom: boolean;
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 0, drawScale: 0.65, density: 0.5, bloom: false },
  medium: { pixelRatio: 1.5, shadows: true, shadowSize: 1024, drawScale: 0.85, density: 0.8, bloom: false },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, drawScale: 1, density: 1, bloom: true },
};

export const QUALITY_NAMES: Record<QualityChoice, string> = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };
const KEY = 'rtm-quality';
const ORDER: QualityChoice[] = ['auto', 'low', 'medium', 'high'];

export interface DeviceHints {
  cores?: number;
  memoryGB?: number;
  mobile?: boolean;
  pixelRatio?: number;
}

/** Best guess for this device: phones get Medium, weak devices Low, desktops High. */
export function autoQuality(h: DeviceHints): QualityLevel {
  const cores = h.cores ?? 4;
  const mem = h.memoryGB ?? 4;
  if (cores <= 4 || mem <= 3) return 'low';
  if (h.mobile) return 'medium';
  return 'high';
}

function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  return {
    cores: nav.hardwareConcurrency,
    memoryGB: nav.deviceMemory,
    mobile: nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav.userAgent),
  };
}

export function loadQualityChoice(): QualityChoice {
  try {
    const v = localStorage.getItem(KEY) as QualityChoice | null;
    if (v && ORDER.includes(v)) return v;
  } catch {
    /* storage blocked */
  }
  return 'auto';
}

export function saveQualityChoice(c: QualityChoice): void {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* storage blocked */
  }
}

export const nextQualityChoice = (c: QualityChoice): QualityChoice => ORDER[(ORDER.indexOf(c) + 1) % ORDER.length];

export function resolveQuality(c: QualityChoice = loadQualityChoice()): QualityLevel {
  return c === 'auto' ? autoQuality(deviceHints()) : c;
}

/** A phone or tablet: High there skips the corner shadows (ambient occlusion) and stays at 1.5x sharpness. */
export const onPhone = !!deviceHints().mobile;

/**
 * High on a phone, measured on a Pixel 6 Pro (2026-11-06): full-sharpness High with
 * ambient occlusion ran at 10 fps; Medium held 60. This keeps High's glow, colour
 * grade, bigger shadows and longer view, but not the two costliest parts.
 */
const PHONE_HIGH: QualityProfile = { ...QUALITY.high, pixelRatio: 1.5 };

/** The quality in use right now (scenes read this when they build). */
export const quality = {
  level: resolveQuality() as QualityLevel,
  get profile(): QualityProfile {
    return this.level === 'high' && onPhone ? PHONE_HIGH : QUALITY[this.level];
  },
};

/** The game's one renderer, for scenes that bake their own lighting (sky reflections). Set by main.ts. */
export const gfx: { renderer: import('three').WebGLRenderer | null } = { renderer: null };
