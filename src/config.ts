/**
 * RAINLINE – central tunables.
 *
 * Every number that affects game feel, difficulty or progression lives here so
 * balancing never requires hunting through gameplay code. Units: meters,
 * seconds, meters/second unless noted.
 */

export const CONFIG = {
  render: {
    /** Cap device pixel ratio – the single biggest perf lever on laptops. */
    maxPixelRatio: 1.5,
    clearColor: 0x05080a,
    fogColor: 0x070c10,
    fogDensity: 0.022,
    /** Base camera field of view (degrees). */
    fov: 62,
    /** Extra FOV added at sprint speed (scaled by speed / baseSpeed). */
    fovSpeedBoost: 12,
  },

  /**
   * "Graphic noir" look: grounded cinematic rendering (PBR, wet reflections,
   * bloom, filmic grade) with a restrained graphic-novel layer (thin ink
   * lines, hatching only in the deepest shadows). These are defaults; the
   * style panel (F2) edits a live copy and exports JSON to paste here.
   */
  style: {
    /** Ink line opacity (0 = off) and thickness in screen px. */
    inkLines: 0.55,
    outlineThickness: 1.1,
    /** Depth jump (relative) that counts as a silhouette edge. */
    depthEdgeThreshold: 0.045,
    /** Surface angle change (0..2) that counts as a crease. */
    normalEdgeThreshold: 0.6,
    /** Character silhouette outline thickness in meters (0 = off). */
    hullThickness: 0.01,
    /** Hatching in deep shadow only: darkness, spacing (m), and light level where it starts. */
    hatchStrength: 0.28,
    hatchSpacing: 0.08,
    hatchThreshold: 0.32,
    /** Fresnel rim light on characters (keeps dark clothing readable). */
    rimLight: 0.35,
    /** Hand-drawn line jitter (off by default for the grounded look). */
    boil: false,
    boilFps: 10,
    boilAmount: 0.6,
    /** Filmic exposure. */
    exposure: 1.0,
    /** Bloom on neon / lights. */
    bloomStrength: 0.55,
    bloomRadius: 0.35,
    bloomThreshold: 1.1,
    /** Wet-ground reflection strength 0..1 and overall wetness. */
    reflections: 0.85,
    wetness: 0.8,
    /** Exp2 fog density (glowing haze, not black). */
    fogDensity: 0.016,
    /** Color grade preset (see GRADES in render/look/LookStyle.ts). */
    grade: 'matrix' as string,
    /** 0..1 strength of the grade's tint. */
    gradeAmount: 0.7,
    filmGrain: 0.03,
    /** Chromatic aberration at the frame edges (fraction of screen). */
    chromaticAberration: 0.0022,
    vignette: 0.4,
    /** Raindrops on the lens. */
    lensRain: 0.2,
    /** Sprint speed lines (graphic-novel accent; 0 disables). */
    speedLines: 0.45,
    /** Onomatopoeia pops on big impacts. */
    comicFx: true,
    /** Real-time shadows from the moon key light (characters + obstacles). */
    shadows: true,
    /** 'high' = reflections + shadows + full-res; 'low' = env-map-only reflections, no shadows, 1x pixel ratio. */
    quality: 'high' as 'high' | 'low',
  },

  camera: {
    /** Offset from the player (behind = +z, since the player runs toward -z). */
    offset: { x: 0, y: 3.3, z: 6.4 },
    /** Point the camera looks at, relative to the player. */
    lookAhead: { y: 1.3, z: -7 },
    /** How fast the camera follows lateral movement (higher = snappier). */
    followLerp: 9,
    /** Fraction of the player's lateral offset the camera follows (1 = locked behind). */
    lateralFollow: 0.75,
    /** Landing / impact shake decay rate (per second) and cap. */
    shakeDecay: 8,
    shakeMax: 0.6,
  },

  lanes: {
    count: 3,
    width: 2.6,
    /** Seconds to slide from one lane to the next. */
    switchTime: 0.13,
  },

  player: {
    baseSpeed: 15,
    /** Speed ramps from base toward base * this over a run. */
    maxSpeedMultiplier: 1.25,
    sprintMultiplier: 1.4,
    sprintDuration: 1.1,
    sprintCooldown: 5,
    /** Initial vertical velocity of a jump. */
    jumpVelocity: 10,
    gravity: 32,
    /** Gravity multiplier while rising with the jump key released (variable jump height). */
    jumpCutGravityMult: 2.6,
    /** Gravity multiplier when slide is pressed mid-air (fast fall). */
    fastFallGravityMult: 3.5,
    slideDuration: 0.72,
    /** Jump/slide pressed this long before landing still triggers on landing. */
    inputBufferTime: 0.16,
    /** Jump allowed this long after leaving the ground. */
    coyoteTime: 0.08,
    height: 1.8,
    slideHeight: 0.75,
    halfWidth: 0.35,
    halfDepth: 0.3,
    /** Stumble: speed multiplier and duration after hitting an obstacle. */
    stumbleDuration: 0.85,
    stumbleSpeedMult: 0.45,
    /** Brief invulnerability after a stumble so one obstacle can't chain-hit. */
    stumbleGrace: 1.0,
    /** Speed recovers from stumble toward target at this rate (m/s^2). */
    speedRecoverAccel: 18,
    /** Squash & stretch: vertical stretch per m/s of vertical speed while airborne. */
    stretchPerSpeed: 0.018,
  },

  chase: {
    /** Gap (meters) between the player and the lead Agent at start. */
    startGap: 22,
    maxGap: 30,
    /** Agents run at this fraction of the player's base speed (before mission scaling). */
    agentSpeedRatio: 0.97,
    /** Extra flat gap lost per stumble on top of the slowdown. */
    stumbleGapPenalty: 2.5,
    /** Gap at which the heartbeat / danger HUD kicks in. */
    dangerGap: 9,
    /** Agent approach speed while you're stopped at the payphone (m/s). */
    callApproachSpeed: 3.5,
  },

  call: {
    /** Seconds of holding E to complete the call. */
    duration: 4,
    /** Progress lost per second while E is released (fraction of duration). */
    releaseDecay: 0.35,
    /** Distance before the booth where the player starts braking. */
    brakeDistance: 9,
  },

  level: {
    chunkLength: 40,
    chunksAhead: 6,
    chunksBehind: 1,
    /** First N chunks are obstacle-free so the player can settle in. */
    safeStartChunks: 1,
    /** Spacing between obstacle rows at density 0 and density 1. */
    rowSpacingSparse: 22,
    rowSpacingDense: 11,
    streetHalfWidth: 4.2,
    sidewalkWidth: 2.4,
  },

  rain: {
    drops: 2600,
    areaRadius: 22,
    height: 18,
    fallSpeed: 34,
    streakLength: 0.9,
  },

  audio: {
    /** Default volumes (0..1) for a fresh save. */
    defaultVolumes: { master: 0.8, music: 0.7, sfx: 0.9 },
    rainLevel: 0.22,
    musicLevel: 0.55,
    music: { bpm: 96 },
    /** Seconds between lightning strikes (random in range) and thunder delay. */
    lightningInterval: [7, 16] as [number, number],
  },

  xp: {
    successBase: 120,
    perMissionBonus: 40,
    /** On CAUGHT you get this fraction of successBase scaled by distance covered. */
    caughtFraction: 0.35,
  },
} as const;

export type ThemeId = 'street' | 'apartment' | 'rooftop' | 'subway' | 'office';

export interface MissionDef {
  id: number;
  name: string;
  theme: ThemeId;
  /** Distance from start to the payphone. */
  length: number;
  seed: number;
  /** Multiplies player base speed (and Agent speed). */
  speedMult: number;
  /** 0..1 obstacle density. */
  density: number;
  agents: number;
  /** Starting chase gap override. */
  startGap: number;
  callDuration: number;
}

/**
 * Linear campaign. Only mission 1 is playable until later milestones add
 * the other themes; values here already follow the difficulty curve.
 */
export const MISSIONS: MissionDef[] = [
  { id: 1, name: 'Wet Wire', theme: 'street', length: 900, seed: 1101, speedMult: 1.0, density: 0.45, agents: 1, startGap: 22, callDuration: 4.0 },
  { id: 2, name: 'Stairwell Static', theme: 'apartment', length: 1100, seed: 2203, speedMult: 1.06, density: 0.55, agents: 2, startGap: 21, callDuration: 3.8 },
  { id: 3, name: 'Skyline Drop', theme: 'rooftop', length: 1300, seed: 3307, speedMult: 1.12, density: 0.62, agents: 2, startGap: 20, callDuration: 3.6 },
  { id: 4, name: 'Dead Rail', theme: 'subway', length: 1500, seed: 4409, speedMult: 1.18, density: 0.7, agents: 3, startGap: 19, callDuration: 3.4 },
  { id: 5, name: 'Glass Ceiling', theme: 'office', length: 1700, seed: 5501, speedMult: 1.25, density: 0.78, agents: 3, startGap: 18, callDuration: 3.2 },
];
