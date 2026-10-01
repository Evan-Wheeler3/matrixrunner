import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { FacadeTextures } from './comicMaterials';

/**
 * Hand-drawn-looking canvas textures. Everything is inked procedurally with
 * slightly jittered strokes so nothing looks ruler-straight.
 */

const INK = '#16171c';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A pencil-ish line: two slightly offset jittered passes. */
function sketchLine(g: CanvasRenderingContext2D, rng: Rng, x1: number, y1: number, x2: number, y2: number, width = 2, color = INK, alpha = 1): void {
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    g.globalAlpha = alpha * (pass === 0 ? 1 : 0.45);
    g.lineWidth = width * (pass === 0 ? 1 : 0.6);
    const j = width * 0.6;
    const mx = (x1 + x2) / 2 + rng.range(-j, j);
    const my = (y1 + y2) / 2 + rng.range(-j, j);
    g.beginPath();
    g.moveTo(x1 + rng.range(-j, j), y1 + rng.range(-j, j));
    g.quadraticCurveTo(mx, my, x2 + rng.range(-j, j), y2 + rng.range(-j, j));
    g.stroke();
  }
  g.globalAlpha = 1;
}

function sketchRect(g: CanvasRenderingContext2D, rng: Rng, x: number, y: number, w: number, h: number, width = 2.5): void {
  // Slight overshoot at corners like a quick ink drawing.
  const o = width * 1.5;
  sketchLine(g, rng, x - o, y, x + w + o, y, width);
  sketchLine(g, rng, x - o, y + h, x + w + o, y + h, width);
  sketchLine(g, rng, x, y - o, x, y + h + o, width);
  sketchLine(g, rng, x + w, y - o, x + w, y + h + o, width);
}

/** Parallel hatch strokes clipped to a rect. */
function hatchRect(g: CanvasRenderingContext2D, rng: Rng, x: number, y: number, w: number, h: number, spacing: number, angle = Math.PI / 4, alpha = 0.6, width = 1.2): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const diag = Math.hypot(w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let s = -diag / 2; s < diag / 2; s += spacing * rng.range(0.8, 1.2)) {
    const px = cx - dy * s;
    const py = cy + dx * s;
    sketchLine(g, rng, px - dx * diag, py - dy * diag, px + dx * diag, py + dy * diag, width, INK, alpha);
  }
  g.restore();
}

function grain(g: CanvasRenderingContext2D, rng: Rng, w: number, h: number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rng.chance(0.5) ? `rgba(20,20,25,${alpha})` : `rgba(255,255,250,${alpha})`;
    g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 2.5), rng.range(1, 2.5));
  }
}

// -----------------------------------------------------------------------------
// Facades
// -----------------------------------------------------------------------------

export type FacadeStyle = 'brick' | 'concrete' | 'fireEscape' | 'office' | 'tiled';
export const FACADE_STYLES: FacadeStyle[] = ['brick', 'concrete', 'fireEscape', 'office', 'tiled'];

const FW = 256; // canvas width  -> tileWidth meters
const FH = 512; // canvas height -> bottom 128px ground floor, top 384px = 2 upper floors

/**
 * Draw a facade tile. Layout (canvas y down): rows 0..383 = two upper floors
 * (module), rows 384..511 = ground floor. With flipY the bottom of the canvas
 * maps to v=0, which is what the facade shader expects.
 */
export function facadeTexture(styleName: FacadeStyle, seed: number): FacadeTextures {
  const [c, g] = canvas(FW, FH);
  const [gc, gg] = canvas(FW, FH);
  const rng = new Rng(seed);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, FW, FH);

  const wall = { brick: '#cdb9a4', concrete: '#c6c6c0', fireEscape: '#d3c4ae', office: '#bfc7c9', tiled: '#d8d2c4' }[styleName];
  g.fillStyle = wall;
  g.fillRect(0, 0, FW, FH);
  grain(g, rng, FW, FH, 900, 0.08);

  // Surface pattern.
  if (styleName === 'brick' || styleName === 'fireEscape') {
    for (let y = 4; y < 384; y += 9) {
      sketchLine(g, rng, 0, y, FW, y, 0.8, INK, 0.18);
      const off = (y / 9) % 2 ? 0 : 11;
      for (let x = off; x < FW; x += 22) if (rng.chance(0.55)) sketchLine(g, rng, x, y, x, y + 9, 0.8, INK, 0.16);
    }
  } else if (styleName === 'tiled') {
    for (let y = 0; y < 384; y += 16) sketchLine(g, rng, 0, y, FW, y, 0.8, INK, 0.2);
    for (let x = 0; x < FW; x += 16) sketchLine(g, rng, x, 0, x, 384, 0.8, INK, 0.12);
  } else if (styleName === 'concrete') {
    for (let y = 0; y < 384; y += 96) sketchLine(g, rng, 0, y + 2, FW, y + 2, 2, INK, 0.5);
    for (let i = 0; i < 8; i++) {
      const x = rng.range(0, FW);
      sketchLine(g, rng, x, rng.range(0, 380), x + rng.range(-6, 6), rng.range(0, 380), 0.8, INK, 0.25); // cracks
    }
  }

  // Upper floors: 2 floors of 192px each.
  const lit = (x: number, y: number, w: number, h: number) => {
    const warm = rng.pick(['#f7c948', '#f5b942', '#fbe08a', '#9ff0d8']);
    g.fillStyle = warm;
    g.fillRect(x, y, w, h);
    gg.fillStyle = '#fff';
    gg.fillRect(x, y, w, h);
    // Silhouette in some lit windows (a person, a plant, a lamp).
    if (rng.chance(0.3)) {
      g.fillStyle = INK;
      const sx = x + rng.range(w * 0.2, w * 0.6);
      g.beginPath();
      g.ellipse(sx, y + h * 0.42, w * 0.08, h * 0.1, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(sx - w * 0.12, y + h * 0.52, w * 0.24, h * 0.5);
    } else if (rng.chance(0.4)) {
      // Blinds.
      for (let by = y + 6; by < y + h; by += 7) sketchLine(g, rng, x, by, x + w, by, 1, INK, 0.45);
    }
  };
  const dark = (x: number, y: number, w: number, h: number) => {
    g.fillStyle = rng.pick(['#4a5a61', '#56636a', '#3d4b52']);
    g.fillRect(x, y, w, h);
    hatchRect(g, rng, x, y, w, h, 7, Math.PI / 4, 0.5, 1);
    // Glass glint.
    sketchLine(g, rng, x + w * 0.2, y + h * 0.15, x + w * 0.45, y + h * 0.05, 2, '#e9eef0', 0.8);
  };

  for (let floor = 0; floor < 2; floor++) {
    const fy = floor * 192;
    if (styleName === 'office') {
      // Ribbon windows with mullions.
      const wy = fy + 50;
      const wh = 96;
      for (let x = 0; x < FW; x += 64) (rng.chance(0.45) ? lit : dark)(x + 4, wy, 56, wh);
      for (let x = 0; x <= FW; x += 64) sketchLine(g, rng, x + 2, wy - 4, x + 2, wy + wh + 4, 3);
      sketchLine(g, rng, 0, wy, FW, wy, 3);
      sketchLine(g, rng, 0, wy + wh, FW, wy + wh, 3);
      hatchRect(g, rng, 0, wy + wh + 4, FW, 18, 5, -Math.PI / 4, 0.35);
      continue;
    }
    const cols = styleName === 'tiled' ? 3 : 2;
    const ww = styleName === 'tiled' ? 52 : 72;
    const wh = styleName === 'concrete' ? 92 : 110;
    for (let i = 0; i < cols; i++) {
      const x = (FW / cols) * (i + 0.5) - ww / 2;
      const y = fy + 42;
      (rng.chance(0.42) ? lit : dark)(x, y, ww, wh);
      // Mullion cross.
      sketchLine(g, rng, x + ww / 2, y, x + ww / 2, y + wh, 2);
      if (styleName !== 'concrete') sketchLine(g, rng, x, y + wh * 0.45, x + ww, y + wh * 0.45, 2);
      sketchRect(g, rng, x, y, ww, wh, 3);
      // Sill with a shadow wedge of hatching, and the odd drip stain.
      g.fillStyle = '#e8e2d4';
      g.fillRect(x - 6, y + wh, ww + 12, 7);
      sketchRect(g, rng, x - 6, y + wh, ww + 12, 7, 1.8);
      hatchRect(g, rng, x - 4, y + wh + 7, ww + 8, 10, 4, Math.PI / 3, 0.45, 1);
      if (rng.chance(0.4)) sketchLine(g, rng, x + rng.range(5, ww - 5), y + wh + 10, x + rng.range(5, ww - 5), y + wh + rng.range(30, 70), 2, INK, 0.25);
      // Lintel shadow.
      hatchRect(g, rng, x - 2, y - 10, ww + 4, 10, 4, -Math.PI / 4, 0.4, 1);
      // AC unit.
      if (rng.chance(0.25)) {
        g.fillStyle = '#d9d6cf';
        g.fillRect(x + ww * 0.15, y + wh + 9, ww * 0.6, 26);
        sketchRect(g, rng, x + ww * 0.15, y + wh + 9, ww * 0.6, 26, 2);
        for (let k = 0; k < 4; k++) sketchLine(g, rng, x + ww * 0.2, y + wh + 14 + k * 5, x + ww * 0.7, y + wh + 14 + k * 5, 1, INK, 0.6);
      }
    }
    if (styleName === 'fireEscape') {
      // Iron balcony + zig-zag ladder over the windows.
      const by = fy + 150;
      sketchLine(g, rng, 10, by, FW - 10, by, 4);
      sketchLine(g, rng, 10, by - 30, FW - 10, by - 30, 2);
      for (let x = 14; x < FW - 10; x += 12) sketchLine(g, rng, x, by - 30, x, by, 1.4);
      sketchLine(g, rng, 30, by, FW - 40, by - 150, 3);
      sketchLine(g, rng, 44, by, FW - 26, by - 150, 3);
      for (let k = 1; k < 12; k++) {
        const t = k / 12;
        sketchLine(g, rng, 30 + t * (FW - 70), by - t * 150, 44 + t * (FW - 70), by - t * 150, 1.6);
      }
    }
  }

  // Ground floor (canvas y 384..512).
  const gy = 384;
  sketchLine(g, rng, 0, gy + 2, FW, gy + 2, 4); // floor line
  if (rng.chance(0.5) || styleName === 'office') {
    // Lit storefront with mullions and a striped awning.
    lit(14, gy + 30, FW - 28, 80);
    for (let x = 14; x <= FW - 14; x += (FW - 28) / 4) sketchLine(g, rng, x, gy + 30, x, gy + 110, 3);
    sketchRect(g, rng, 14, gy + 30, FW - 28, 80, 3.5);
    const awn = rng.pick(['#d6336c', '#2bb5b8', '#e8c547', '#3fbf6e']);
    for (let x = 6; x < FW - 6; x += 24) {
      g.fillStyle = (x / 24) % 2 < 1 ? awn : '#f0e9da';
      g.fillRect(x, gy + 10, 24, 18);
    }
    sketchRect(g, rng, 6, gy + 10, FW - 12, 18, 2.5);
  } else {
    // Rolled-down shutter with graffiti scrawl.
    g.fillStyle = '#9fa3a3';
    g.fillRect(14, gy + 22, FW - 28, 90);
    for (let y = gy + 26; y < gy + 112; y += 6) sketchLine(g, rng, 14, y, FW - 14, y, 1.2, INK, 0.55);
    sketchRect(g, rng, 14, gy + 22, FW - 28, 90, 3.5);
    g.strokeStyle = rng.pick(['#d6336c', '#2bb5b8', '#3fbf6e']);
    g.lineWidth = 5;
    g.beginPath();
    let x = 40;
    g.moveTo(x, gy + 70);
    while (x < FW - 50) {
      x += rng.range(10, 22);
      g.lineTo(x, gy + rng.range(50, 95));
    }
    g.stroke();
  }
  // Kerb-level grime hatching.
  hatchRect(g, rng, 0, FH - 16, FW, 16, 4, Math.PI / 4, 0.5);

  const map = texture(c);
  const glow = texture(gc, false);
  return { map, glow, tileWidth: 6, moduleHeight: 8 };
}

// -----------------------------------------------------------------------------
// Ground
// -----------------------------------------------------------------------------

/** Road tile: warm-gray wet asphalt, ink speckle, cracks, bold lane dashes. */
export function comicRoadTexture(laneDividers: number[]): THREE.CanvasTexture {
  const W = 256;
  const H = 366; // ~ 8.4m x 12m
  const [c, g] = canvas(W, H);
  const rng = new Rng(21);
  g.fillStyle = '#8f908b';
  g.fillRect(0, 0, W, H);
  grain(g, rng, W, H, 2200, 0.12);
  // Wet patches drawn as loose hatching.
  for (let i = 0; i < 5; i++) {
    hatchRect(g, rng, rng.range(0, W - 80), rng.range(0, H - 60), rng.range(40, 90), rng.range(30, 70), 6, rng.range(0.5, 1.2), 0.25, 1);
  }
  // Cracks.
  for (let i = 0; i < 5; i++) {
    let x = rng.range(0, W);
    let y = rng.range(0, H);
    for (let k = 0; k < 5; k++) {
      const nx = x + rng.range(-18, 18);
      const ny = y + rng.range(6, 22);
      sketchLine(g, rng, x, y, nx, ny, 1, INK, 0.5);
      x = nx;
      y = ny;
    }
  }
  // Lane dashes: paper-white paint with an ink outline.
  for (const nx of laneDividers) {
    const x = nx * W;
    for (const y0 of [30, 213]) {
      g.fillStyle = '#efe9da';
      g.fillRect(x - 4, y0, 8, 120);
      sketchRect(g, rng, x - 4, y0, 8, 120, 1.6);
    }
  }
  // Edge lines in warm yellow.
  for (const x of [8, W - 8]) {
    g.fillStyle = '#e8c547';
    g.fillRect(x - 3, 0, 6, H);
    sketchLine(g, rng, x - 3, 0, x - 3, H, 1.2);
    sketchLine(g, rng, x + 3, 0, x + 3, H, 1.2);
  }
  // A manhole cover.
  g.fillStyle = '#6d6f6c';
  g.beginPath();
  g.ellipse(W * 0.3, H * 0.6, 20, 20, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 2.5;
  g.stroke();
  for (let k = -12; k <= 12; k += 6) sketchLine(g, rng, W * 0.3 - 14, H * 0.6 + k, W * 0.3 + 14, H * 0.6 + k, 1, INK, 0.7);
  return texture(c);
}

export function comicSidewalkTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 183);
  const rng = new Rng(5);
  g.fillStyle = '#c4beb0';
  g.fillRect(0, 0, 128, 183);
  grain(g, rng, 128, 183, 700, 0.1);
  for (let y = 0; y <= 183; y += 46) sketchLine(g, rng, 0, y, 128, y, 1.8, INK, 0.8);
  sketchLine(g, rng, 64, 0, 64, 183, 1.4, INK, 0.5);
  hatchRect(g, rng, 0, 0, 14, 183, 5, Math.PI / 4, 0.4); // curb-side shadow
  return texture(c);
}

// -----------------------------------------------------------------------------
// Signs, pools, puddles, shadows, skyline
// -----------------------------------------------------------------------------

/** Vertical neon blade sign with stacked letters. */
export function signTexture(word: string, color: string): THREE.CanvasTexture {
  const W = 64;
  const H = 256;
  const [c, g] = canvas(W, H);
  const rng = new Rng(word.length * 31 + color.length);
  g.fillStyle = '#1b1d24';
  g.fillRect(0, 0, W, H);
  const step = H / (word.length + 0.6);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.min(46, step * 0.86)}px Impact, 'Arial Black', sans-serif`;
  for (let i = 0; i < word.length; i++) {
    const y = step * (i + 0.8);
    // Glow halo as a fat colored stroke, then bright core.
    g.lineWidth = 9;
    g.strokeStyle = color;
    g.globalAlpha = 0.45;
    g.strokeText(word[i], W / 2, y);
    g.globalAlpha = 1;
    g.lineWidth = 3;
    g.strokeText(word[i], W / 2, y);
    g.fillStyle = '#fffbea';
    g.fillText(word[i], W / 2, y);
  }
  g.lineWidth = 4;
  g.strokeStyle = color;
  g.strokeRect(4, 4, W - 8, H - 8);
  sketchRect(g, rng, 1, 1, W - 2, H - 2, 2.5);
  const t = texture(c, true, false);
  return t;
}

/** Halftone glow pool: dot size falls off with radius. White, tinted per instance. */
export function halftonePoolTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#fff';
  const cell = 7;
  for (let y = cell / 2; y < S; y += cell) {
    for (let x = cell / 2; x < S; x += cell) {
      const r = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
      const k = Math.max(0, 1 - r);
      if (k <= 0) continue;
      g.beginPath();
      g.arc(x, y, (cell / 2) * Math.sqrt(k) * 1.05, 0, Math.PI * 2);
      g.fill();
    }
  }
  return texture(c, true, false);
}

/** Puddle: flat reflective shape, inked rim and ripple rings. Tinted per instance. */
export function puddleTexture(seed: number): THREE.CanvasTexture {
  const W = 128;
  const H = 128;
  const [c, g] = canvas(W, H);
  const rng = new Rng(seed);
  // Wobbly blob outline.
  const pts: [number, number][] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = rng.range(0.75, 1);
    pts.push([W / 2 + Math.cos(a) * (W * 0.46) * r, H / 2 + Math.sin(a) * (H * 0.46) * r]);
  }
  const path = () => {
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = pts[i % n];
      const [px, py] = pts[(i + n - 1) % n];
      if (i === 0) g.moveTo(x, y);
      else g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
    }
    g.closePath();
  };
  path();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fill();
  // Mirrored reflection streaks (vertical, since they reflect upright signs).
  g.save();
  path();
  g.clip();
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(rng.range(10, W - 20), 0, rng.range(4, 12), H);
  }
  g.restore();
  g.lineWidth = 3;
  g.strokeStyle = INK;
  path();
  g.stroke();
  // Ripple rings.
  g.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    g.globalAlpha = 0.7;
    g.beginPath();
    g.ellipse(rng.range(35, W - 35), rng.range(35, H - 35), rng.range(6, 16), rng.range(4, 10), 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
  return texture(c, true, false);
}

/** Drop shadow: inked ellipse with halftone falloff. */
export function shadowBlobTexture(): THREE.CanvasTexture {
  const S = 64;
  const [c, g] = canvas(S, S);
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(S / 2, S / 2, S * 0.34, S * 0.34, 0, 0, Math.PI * 2);
  g.fill();
  for (let y = 2; y < S; y += 5) {
    for (let x = 2; x < S; x += 5) {
      const r = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
      if (r < 0.34 || r > 0.5) continue;
      g.beginPath();
      g.arc(x, y, 1.6 * (1 - (r - 0.34) / 0.16), 0, Math.PI * 2);
      g.fill();
    }
  }
  return texture(c, true, false);
}

/** Flat cut-out skyline strip with an inked top edge and sparse windows. */
export function skylineTexture(seed: number, fill: string, windowColor: string, windowChance: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const [c, g] = canvas(W, H);
  const rng = new Rng(seed);
  g.clearRect(0, 0, W, H);
  let x = 0;
  const tops: [number, number, number][] = [];
  while (x < W) {
    const w = rng.range(30, 90);
    const top = rng.range(30, 200);
    tops.push([x, w, top]);
    x += w;
  }
  g.fillStyle = fill;
  for (const [bx, w, top] of tops) {
    g.fillRect(bx, top, w + 1, H - top);
    if (rng.chance(0.25)) g.fillRect(bx + w * 0.45, top - rng.range(10, 30), 3, 30); // antenna
    if (rng.chance(0.15)) {
      // Water tower.
      g.fillRect(bx + w * 0.2, top - 18, 16, 14);
      g.fillRect(bx + w * 0.2 + 2, top - 6, 2, 6);
      g.fillRect(bx + w * 0.2 + 12, top - 6, 2, 6);
    }
  }
  // Windows.
  for (const [bx, w, top] of tops) {
    for (let wy = top + 8; wy < H - 6; wy += 9) {
      for (let wx = bx + 5; wx < bx + w - 5; wx += 8) {
        if (!rng.chance(windowChance)) continue;
        g.fillStyle = windowColor;
        g.fillRect(wx, wy, 3, 4);
      }
    }
  }
  // Ink the silhouette edge only (comic backdrop).
  g.strokeStyle = INK;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(0, tops[0][2]);
  for (const [bx, w, top] of tops) {
    g.lineTo(bx, top);
    g.lineTo(bx + w, top);
  }
  g.stroke();
  const t = texture(c, true, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
