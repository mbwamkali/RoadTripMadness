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

/**
 * First guess for this device: weak devices Low, everything else High (phones get
 * the lighter phone High). Auto then times the first stretch of driving and steps
 * down if it's slow (autoTune.ts), and remembers that on the device.
 */
export function autoQuality(h: DeviceHints): QualityLevel {
  const cores = h.cores ?? 4;
  const mem = h.memoryGB ?? 4;
  if (cores <= 4 || mem <= 3) return 'low';
  return 'high';
}

const RANK: Record<QualityLevel, number> = { low: 0, medium: 1, high: 2 };
const CAP_KEY = 'rtm-auto-cap';

/** The level Auto measured this device down to, if it had to step down. */
export function loadAutoCap(): QualityLevel | null {
  try {
    const v = localStorage.getItem(CAP_KEY) as QualityLevel | null;
    return v && v in RANK ? v : null;
  } catch {
    return null;
  }
}

/** Remember Auto's measured level (null forgets it, so the next drive is timed afresh). */
export function saveAutoCap(level: QualityLevel | null): void {
  try {
    if (level) localStorage.setItem(CAP_KEY, level);
    else localStorage.removeItem(CAP_KEY);
  } catch {
    /* storage blocked */
  }
}

/** The lower of two levels. */
export const lowerOf = (a: QualityLevel, b: QualityLevel | null): QualityLevel => (b && RANK[b] < RANK[a] ? b : a);

function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  return {
    cores: nav.hardwareConcurrency,
    memoryGB: nav.deviceMemory,
    mobile: isMobile(nav),
  };
}

/**
 * A phone or tablet. Chrome's own flag and the browser name miss a phone showing
 * the desktop version of sites (a Pixel 11 Pro XL came up as a computer), so a
 * touch-only screen also counts.
 */
function isMobile(nav: Navigator & { userAgentData?: { mobile?: boolean } }): boolean {
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|Mobile/i.test(nav.userAgent)) return true;
  try {
    return nav.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
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
  return c === 'auto' ? lowerOf(autoQuality(deviceHints()), loadAutoCap()) : c;
}

/** A phone or tablet: High there skips the corner shadows (ambient occlusion) and stays at 1.5x sharpness. */
export const onPhone = !!deviceHints().mobile;

/**
 * High on a phone, measured on a Pixel 6 Pro (2026-11-06): full-sharpness High with
 * ambient occlusion ran at 10 fps; Medium held 60. This keeps High's glow, colour
 * grade, bigger shadows and longer view, but not the two costliest parts.
 */
// Build 102 (no AO, 1.5x) still ran 17-37 fps with the glow pass on, so phones skip that too.
const PHONE_HIGH: QualityProfile = { ...QUALITY.high, pixelRatio: 1.5, bloom: false };

/** Test-panel overrides (?dev=1) for trying effects on a real phone; undefined = the quality's own. */
export const devGfx: { post?: boolean; ratio?: number } = {};

/** The quality in use right now (scenes read this when they build). */
export const quality = {
  level: resolveQuality() as QualityLevel,
  get profile(): QualityProfile {
    const base = this.level === 'high' && onPhone ? PHONE_HIGH : QUALITY[this.level];
    if (devGfx.post === undefined && devGfx.ratio === undefined) return base;
    return { ...base, bloom: devGfx.post ?? base.bloom, pixelRatio: devGfx.ratio ?? base.pixelRatio };
  },
};

/** The game's one renderer, for scenes that bake their own lighting (sky reflections). Set by main.ts. */
export const gfx: { renderer: import('three').WebGLRenderer | null } = { renderer: null };
