import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { FacadeSet } from './materials';

/**
 * Procedural PBR textures (no image assets). A `Painter` draws the same
 * shapes into four canvases at once – albedo, height, ORM (G = roughness,
 * B = metalness, R = puddle mask for ground), emissive – and the height
 * canvas is converted to a tangent-space normal map.
 */

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const gray = (v: number) => {
  const c = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
  return `rgb(${c},${c},${c})`;
};

export interface Surface {
  /** CSS albedo color. */
  albedo?: string;
  /** 0..1 relative height (0.5 = wall plane). */
  height?: number;
  rough?: number;
  metal?: number;
  /** CSS emissive color (omit = no emission). */
  emissive?: string;
  /** Puddle / wetness mask 0..1 (ground only). */
  puddle?: number;
}

/** Draws matching shapes into albedo / height / ORM / emissive canvases. */
export class Painter {
  readonly a: Ctx;
  readonly h: Ctx;
  readonly o: Ctx;
  readonly e: Ctx;
  private canvases: HTMLCanvasElement[];

  constructor(readonly w: number, readonly hgt: number, readonly rng: Rng) {
    const [ca, a] = makeCanvas(w, hgt);
    const [ch, h] = makeCanvas(w, hgt);
    const [co, o] = makeCanvas(w, hgt);
    const [ce, e] = makeCanvas(w, hgt);
    this.a = a;
    this.h = h;
    this.o = o;
    this.e = e;
    this.canvases = [ca, ch, co, ce];
    e.fillStyle = '#000';
    e.fillRect(0, 0, w, hgt);
  }

  /** Apply a surface to a rect in every channel it specifies. */
  rect(x: number, y: number, w: number, h: number, s: Surface): void {
    if (s.albedo) {
      this.a.fillStyle = s.albedo;
      this.a.fillRect(x, y, w, h);
    }
    if (s.height !== undefined) {
      this.h.fillStyle = gray(s.height);
      this.h.fillRect(x, y, w, h);
    }
    if (s.rough !== undefined || s.metal !== undefined || s.puddle !== undefined) {
      // ORM is written per-channel via 'lighter'-free compositing: read-modify is
      // too slow, so callers pass all three when they touch ORM.
      const r = Math.round((s.puddle ?? 0) * 255);
      const g = Math.round((s.rough ?? 0.85) * 255);
      const b = Math.round((s.metal ?? 0) * 255);
      this.o.fillStyle = `rgb(${r},${g},${b})`;
      this.o.fillRect(x, y, w, h);
    }
    if (s.emissive) {
      this.e.fillStyle = s.emissive;
      this.e.fillRect(x, y, w, h);
    }
  }

  /** Random speckle on albedo (and optionally height) for material texture. */
  speckle(x: number, y: number, w: number, h: number, count: number, alpha: number, heightJitter = 0): void {
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      const px = x + r.range(0, w);
      const py = y + r.range(0, h);
      const s = r.range(1, 3);
      const v = r.chance(0.5);
      this.a.fillStyle = v ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.6})`;
      this.a.fillRect(px, py, s, s);
      if (heightJitter > 0) {
        this.h.fillStyle = v ? `rgba(0,0,0,${heightJitter})` : `rgba(255,255,255,${heightJitter})`;
        this.h.fillRect(px, py, s, s);
      }
    }
  }

  /** Vertical grime / rain streaks: darker albedo, slightly glossier (wet). */
  streaks(x: number, y: number, w: number, h: number, count: number): void {
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      const sx = x + r.range(0, w);
      const sw = r.range(2, 8);
      const sh = r.range(h * 0.2, h);
      const sy = y + r.range(0, h - sh);
      const grad = this.a.createLinearGradient(0, sy, 0, sy + sh);
      grad.addColorStop(0, 'rgba(0,0,0,0.28)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      this.a.fillStyle = grad;
      this.a.fillRect(sx, sy, sw, sh);
      this.o.fillStyle = 'rgba(0,70,0,0.25)';
      this.o.fillRect(sx, sy, sw, sh);
    }
  }

  textures(normalStrength = 2.5): { albedo: THREE.CanvasTexture; normal: THREE.CanvasTexture; orm: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
    const [ca, , co, ce] = this.canvases;
    return {
      albedo: toTexture(ca, true),
      normal: toTexture(heightToNormal(this.h, this.w, this.hgt, normalStrength), false),
      orm: toTexture(co, false),
      emissive: toTexture(ce, true),
    };
  }
}

/** Sobel the height canvas into a tangent-space normal map (+Y = texture up). */
function heightToNormal(h: Ctx, w: number, hgt: number, strength: number): HTMLCanvasElement {
  const src = h.getImageData(0, 0, w, hgt).data;
  const [c, g] = makeCanvas(w, hgt);
  const out = g.createImageData(w, hgt);
  const H = (x: number, y: number) => src[(((y + hgt) % hgt) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      // Canvas y grows downward; texture "up" is -y after flipY.
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

// -----------------------------------------------------------------------------
// Facades
// -----------------------------------------------------------------------------

export type FacadeStyle = 'brick' | 'concrete' | 'fireEscape' | 'office' | 'tiled';
export const FACADE_STYLES: FacadeStyle[] = ['brick', 'concrete', 'fireEscape', 'office', 'tiled'];

const FW = 512; // 6 m
const FH = 1024; // rows 0..767 = two 4 m storeys, 768..1023 = 4.2 m ground floor
const SHOP_WORDS = ['NOODLES', 'PAWN', 'LIQUOR', '24/7', 'DINER', 'REPAIR', 'HOTEL', 'KARAOKE'];
const NEON_CSS = ['#3dff9a', '#2de8ec', '#ff3fae', '#ffb347'];

function window_(p: Painter, x: number, y: number, w: number, h: number, frame: string, lit: boolean, opts: { mullions?: boolean; sill?: boolean } = {}): void {
  const r = p.rng;
  // Raised surround, recessed reveal, glass.
  p.rect(x - 8, y - 8, w + 16, h + 16, { albedo: frame, height: 0.68, rough: 0.6, metal: 0 });
  p.rect(x - 2, y - 2, w + 4, h + 4, { albedo: '#15181a', height: 0.2, rough: 0.9, metal: 0 });
  if (lit) {
    const warm = r.pick(['#ffcf7a', '#ffd99a', '#ffe7b8', '#bff5ff', '#ffb25c']);
    const grad = p.a.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, warm);
    grad.addColorStop(1, '#3a2a18');
    p.rect(x, y, w, h, { albedo: '#2a2218', height: 0.24, rough: 0.15, metal: 0 });
    const eg = p.e.createLinearGradient(0, y, 0, y + h);
    eg.addColorStop(0, warm);
    eg.addColorStop(1, 'rgba(60,40,20,1)');
    p.e.fillStyle = eg;
    p.e.fillRect(x, y, w, h);
    // Interior detail: blinds, curtains, or a figure.
    const roll = r.next();
    if (roll < 0.3) {
      for (let by = y + 4; by < y + h * r.range(0.3, 0.9); by += 6) p.rect(x, by, w, 3, { emissive: 'rgba(0,0,0,0.55)' });
    } else if (roll < 0.55) {
      p.rect(x, y, w * r.range(0.15, 0.35), h, { emissive: 'rgba(40,10,10,0.85)' });
      p.rect(x + w * r.range(0.65, 0.85), y, w, h, { emissive: 'rgba(40,10,10,0.85)' });
    } else if (roll < 0.7) {
      const fx = x + r.range(w * 0.25, w * 0.7);
      p.e.fillStyle = 'rgba(0,0,0,0.85)';
      p.e.beginPath();
      p.e.ellipse(fx, y + h * 0.42, w * 0.07, h * 0.08, 0, 0, Math.PI * 2);
      p.e.fill();
      p.e.fillRect(fx - w * 0.12, y + h * 0.5, w * 0.24, h * 0.5);
    }
  } else {
    // Dark glass: glossy, reflects the environment map.
    p.rect(x, y, w, h, { albedo: r.pick(['#141b20', '#18212a', '#10161b']), height: 0.24, rough: 0.06, metal: 0.1 });
  }
  if (opts.mullions !== false) {
    p.rect(x + w / 2 - 3, y, 6, h, { albedo: frame, height: 0.5, rough: 0.6, metal: 0 });
    p.rect(x, y + h * 0.42, w, 5, { albedo: frame, height: 0.5, rough: 0.6, metal: 0 });
  }
  if (opts.sill !== false) {
    p.rect(x - 14, y + h + 8, w + 28, 12, { albedo: '#8f8a80', height: 0.9, rough: 0.7, metal: 0 });
  }
}

function brickField(p: Painter, x0: number, y0: number, w: number, h: number, palette: string[]): void {
  const r = p.rng;
  p.rect(x0, y0, w, h, { albedo: '#5a524a', height: 0.35, rough: 0.95, metal: 0 });
  const bw = 22;
  const bh = 8;
  for (let y = y0, row = 0; y < y0 + h; y += bh, row++) {
    for (let x = x0 - (row % 2) * (bw / 2); x < x0 + w; x += bw) {
      p.rect(x + 1, y + 1, bw - 2, bh - 2, { albedo: r.pick(palette), height: 0.55 + r.range(0, 0.06), rough: 0.88, metal: 0 });
    }
  }
  p.speckle(x0, y0, w, h, 2500, 0.18, 0.08);
}

/**
 * A lit shop interior seen through glass: dim warm room, a bright ceiling
 * strip, rows of shelving with colored product blocks, a counter, a figure
 * or two, and diagonal glass glints. Kept dim so it reads as a room, not a
 * light box.
 */
function shopInterior(p: Painter, x: number, y: number, w: number, h: number): void {
  const r = p.rng;
  const e = p.e;
  const tone = r.pick([
    ['#4a3a26', '#1c140d'],
    ['#2c4a40', '#0e1914'],
    ['#4a3440', '#180e14'],
    ['#40464e', '#121418'],
  ]);
  p.rect(x, y, w, h, { albedo: '#1d1a16', height: 0.25, rough: 0.08, metal: 0 });
  const back = e.createLinearGradient(0, y, 0, y + h);
  back.addColorStop(0, tone[0]);
  back.addColorStop(1, tone[1]);
  e.fillStyle = back;
  e.fillRect(x, y, w, h);
  // Pools of light from ceiling fixtures.
  for (let i = 0; i < 3; i++) {
    const cx = x + w * (0.2 + i * 0.3);
    const pool = e.createRadialGradient(cx, y + 10, 4, cx, y + 30, h * 0.8);
    pool.addColorStop(0, 'rgba(255,236,200,0.22)');
    pool.addColorStop(1, 'rgba(255,236,200,0)');
    e.fillStyle = pool;
    e.fillRect(x, y, w, h);
  }
  e.fillStyle = '#fff4dc';
  e.fillRect(x + 8, y + 6, w - 16, 4); // fluorescent strip
  // Shelving rows with product blocks.
  for (let row = 0; row < 3; row++) {
    const sy = y + 34 + row * 30;
    e.fillStyle = 'rgba(20,14,10,0.85)';
    e.fillRect(x + 10, sy + 22, w * 0.55, 3);
    for (let px = x + 12; px < x + w * 0.55; px += r.range(8, 16)) {
      e.fillStyle = r.pick(['#a8483a', '#c8a050', '#4a7a9a', '#7aa060', '#d0c0a0', '#5a3a6a']);
      e.globalAlpha = 0.7;
      e.fillRect(px, sy + 22 - r.range(8, 18), r.range(5, 10), r.range(8, 18));
      e.globalAlpha = 1;
    }
  }
  // Counter + a customer silhouette.
  e.fillStyle = 'rgba(12,9,7,0.9)';
  e.fillRect(x + w * 0.62, y + h * 0.62, w * 0.34, h * 0.38);
  if (r.chance(0.7)) {
    const fx = x + w * r.range(0.3, 0.75);
    e.beginPath();
    e.ellipse(fx, y + h * 0.42, 9, 11, 0, 0, Math.PI * 2);
    e.fill();
    e.fillRect(fx - 15, y + h * 0.5, 30, h * 0.5);
  }
  // Darken toward the window edges (depth), then glass glints on the albedo.
  const vig = e.createLinearGradient(x, 0, x + w, 0);
  vig.addColorStop(0, 'rgba(0,0,0,0.5)');
  vig.addColorStop(0.15, 'rgba(0,0,0,0)');
  vig.addColorStop(0.85, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  e.fillStyle = vig;
  e.fillRect(x, y, w, h);
  for (let i = 0; i < 2; i++) {
    const gx = x + r.range(0, w * 0.7);
    p.a.fillStyle = 'rgba(200,220,220,0.12)';
    p.a.beginPath();
    p.a.moveTo(gx, y + h);
    p.a.lineTo(gx + 26, y + h);
    p.a.lineTo(gx + 86, y);
    p.a.lineTo(gx + 60, y);
    p.a.fill();
  }
}

function groundFloor(p: Painter, shopChance: number): void {
  const r = p.rng;
  const gy = 768;
  const gh = 256;
  // Base course of stone.
  p.rect(0, gy, FW, gh, { albedo: '#4a4744', height: 0.5, rough: 0.8, metal: 0 });
  p.rect(0, gy, FW, 18, { albedo: '#7d7870', height: 0.85, rough: 0.7, metal: 0 }); // cornice band
  if (r.chance(shopChance)) {
    // Shop sign band with neon or backlit lettering.
    const word = r.pick(SHOP_WORDS);
    const neon = r.pick(NEON_CSS);
    p.rect(20, gy + 24, FW - 40, 46, { albedo: '#101214', height: 0.75, rough: 0.5, metal: 0.2 });
    for (const ctx of [p.e, p.a]) {
      ctx.font = 'bold 34px "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = neon;
      ctx.fillText(word, FW / 2, gy + 48);
    }
    // Storefront glass with lit interior and mullions.
    const sx = 30;
    const sy = gy + 86;
    const sw = FW - 60;
    const sh = 150;
    p.rect(sx - 6, sy - 6, sw + 12, sh + 12, { albedo: '#2b2e30', height: 0.7, rough: 0.35, metal: 0.8 });
    const lit = r.chance(0.75);
    if (lit) {
      shopInterior(p, sx, sy, sw, sh);
    } else {
      p.rect(sx, sy, sw, sh, { albedo: '#121619', height: 0.25, rough: 0.05, metal: 0.1 });
    }
    for (let x = sx; x <= sx + sw; x += sw / 3) p.rect(x - 3, sy, 6, sh, { albedo: '#2b2e30', height: 0.6, rough: 0.35, metal: 0.8 });
  } else {
    // Rolled steel shutter, ribbed.
    const sx = 26;
    const sy = gy + 40;
    const sw = FW - 52;
    const sh = 200;
    p.rect(sx, sy, sw, sh, { albedo: '#6b6e6e', height: 0.55, rough: 0.45, metal: 0.7 });
    for (let y = sy; y < sy + sh; y += 8) p.rect(sx, y, sw, 3, { albedo: '#4c4f50', height: 0.45, rough: 0.5, metal: 0.7 });
    // Spray-paint tag.
    p.a.strokeStyle = r.pick(NEON_CSS);
    p.a.lineWidth = 7;
    p.a.globalAlpha = 0.75;
    p.a.beginPath();
    let x = sx + 40;
    p.a.moveTo(x, sy + 110);
    while (x < sx + sw - 60) {
      x += r.range(14, 30);
      p.a.lineTo(x, sy + r.range(70, 150));
    }
    p.a.stroke();
    p.a.globalAlpha = 1;
  }
  p.streaks(0, gy, FW, gh, 12);
  // Kerb-level grime.
  const grad = p.a.createLinearGradient(0, FH - 50, 0, FH);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.45)');
  p.a.fillStyle = grad;
  p.a.fillRect(0, FH - 50, FW, 50);
}

/** A full PBR facade set for one building style. */
export function facadeSet(styleName: FacadeStyle, seed: number): FacadeSet {
  const p = new Painter(FW, FH, new Rng(seed));
  const r = p.rng;
  const litChance = 0.38;

  if (styleName === 'brick' || styleName === 'fireEscape') {
    brickField(p, 0, 0, FW, 768, styleName === 'brick' ? ['#6e3b2e', '#7a4332', '#5f3428', '#834a37', '#6a3a30'] : ['#5b4a42', '#66544a', '#4f4038', '#6e5a4e']);
  } else if (styleName === 'concrete') {
    p.rect(0, 0, FW, 768, { albedo: '#77756f', height: 0.5, rough: 0.9, metal: 0 });
    p.speckle(0, 0, FW, 768, 5000, 0.12, 0.06);
    for (let y = 0; y < 768; y += 192) p.rect(0, y, FW, 4, { albedo: '#4f4d49', height: 0.3, rough: 0.9, metal: 0 });
    p.rect(FW / 2 - 2, 0, 4, 768, { albedo: '#55534f', height: 0.3, rough: 0.9, metal: 0 });
  } else if (styleName === 'tiled') {
    p.rect(0, 0, FW, 768, { albedo: '#3f4a4a', height: 0.4, rough: 0.6, metal: 0 });
    for (let y = 0; y < 768; y += 16) {
      for (let x = 0; x < FW; x += 16) p.rect(x + 1, y + 1, 14, 14, { albedo: r.pick(['#5e7372', '#6a7f7c', '#566968', '#738886']), height: 0.55, rough: 0.28, metal: 0 });
    }
  } else {
    // Office curtain wall handled below.
    p.rect(0, 0, FW, 768, { albedo: '#2c3236', height: 0.5, rough: 0.4, metal: 0.6 });
  }

  for (let storey = 0; storey < 2; storey++) {
    const fy = storey * 384;
    if (styleName === 'office') {
      const cols = 4;
      const cw = FW / cols;
      for (let c = 0; c < cols; c++) {
        const lit = r.chance(0.45);
        const x = c * cw + 6;
        const y = fy + 30;
        const w = cw - 12;
        const h = 300;
        if (lit) {
          p.rect(x, y, w, h, { albedo: '#2a3438', height: 0.4, rough: 0.12, metal: 0.2 });
          const eg = p.e.createLinearGradient(0, y, 0, y + h);
          eg.addColorStop(0, r.pick(['#d8f6ff', '#c6ffe8', '#eef4ff']));
          eg.addColorStop(1, '#2a4a4a');
          p.e.fillStyle = eg;
          p.e.fillRect(x, y, w, h);
          for (let i = 0; i < 3; i++) p.rect(x + r.range(0, w - 30), y + r.range(h * 0.5, h - 30), r.range(20, 50), r.range(20, 40), { emissive: 'rgba(0,0,0,0.6)' });
        } else {
          p.rect(x, y, w, h, { albedo: '#0f1518', height: 0.4, rough: 0.04, metal: 0.4 });
        }
      }
      for (let c = 0; c <= cols; c++) p.rect(c * cw - 4, fy, 8, 384, { albedo: '#8a9296', height: 0.8, rough: 0.3, metal: 0.9 });
      p.rect(0, fy + 340, FW, 44, { albedo: '#4a5256', height: 0.7, rough: 0.35, metal: 0.8 }); // spandrel
      continue;
    }
    const cols = styleName === 'tiled' ? 3 : 2;
    const ww = styleName === 'tiled' ? 96 : 130;
    const wh = styleName === 'concrete' ? 180 : 210;
    const frame = styleName === 'concrete' ? '#5f5d58' : styleName === 'tiled' ? '#cfd2cc' : '#9a948a';
    for (let i = 0; i < cols; i++) {
      const x = (FW / cols) * (i + 0.5) - ww / 2;
      window_(p, x, fy + 70, ww, wh, frame, r.chance(litChance), { mullions: styleName !== 'concrete' });
      // AC unit hanging under some windows.
      if (r.chance(0.25)) {
        p.rect(x + ww * 0.2, fy + 70 + wh + 26, ww * 0.6, 44, { albedo: '#a7a59f', height: 0.95, rough: 0.5, metal: 0.4 });
        for (let k = 0; k < 5; k++) p.rect(x + ww * 0.25, fy + 70 + wh + 32 + k * 7, ww * 0.5, 3, { albedo: '#5c5b57', height: 0.85, rough: 0.5, metal: 0.4 });
      }
    }
    if (styleName === 'fireEscape') {
      // Iron landing + ladder, raised and metallic.
      const iron = { albedo: '#1e2224', height: 0.98, rough: 0.5, metal: 0.8 };
      const by = fy + 320;
      p.rect(10, by, FW - 20, 8, iron);
      p.rect(10, by - 60, FW - 20, 4, iron);
      for (let x = 14; x < FW - 10; x += 18) p.rect(x, by - 60, 3, 60, iron);
      for (let k = 0; k < 16; k++) {
        const t = k / 16;
        p.rect(60 + t * (FW - 160), by - t * 300, 40, 4, iron);
      }
    }
    p.streaks(0, fy, FW, 384, 10);
  }
  groundFloor(p, styleName === 'office' ? 0.9 : 0.6);
  const t = p.textures(styleName === 'brick' || styleName === 'fireEscape' ? 3.2 : 2.4);
  return { albedo: t.albedo, normal: t.normal, orm: t.orm, emissive: t.emissive, tileWidth: 6, moduleHeight: 8 };
}

// -----------------------------------------------------------------------------
// Ground
// -----------------------------------------------------------------------------

/** Wet asphalt tile (8.4 m x 12 m): aggregate, cracks, worn paint, manhole, puddles. */
export function roadSet(laneDividers: number[]) {
  const W = 512;
  const H = 732;
  const p = new Painter(W, H, new Rng(21));
  const r = p.rng;
  p.rect(0, 0, W, H, { albedo: '#2c2d2e', height: 0.5, rough: 0.62, metal: 0, puddle: 0 });
  p.speckle(0, 0, W, H, 14000, 0.22, 0.2);
  // Tar-sealed patches and seams.
  for (let i = 0; i < 4; i++) p.rect(r.range(0, W - 120), r.range(0, H - 90), r.range(60, 140), r.range(40, 100), { albedo: '#202122', height: 0.47, rough: 0.4, metal: 0, puddle: 0.2 });
  // Cracks.
  p.h.strokeStyle = gray(0.3);
  p.a.strokeStyle = 'rgba(0,0,0,0.6)';
  for (let i = 0; i < 7; i++) {
    let x = r.range(0, W);
    let y = r.range(0, H);
    for (const ctx of [p.a, p.h]) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
    for (let k = 0; k < 6; k++) {
      x += r.range(-26, 26);
      y += r.range(8, 30);
      p.a.lineTo(x, y);
      p.h.lineTo(x, y);
    }
    p.a.stroke();
    p.h.stroke();
  }
  // Puddles: smooth, low, mirror-like.
  for (let i = 0; i < 6; i++) {
    const cx = r.range(30, W - 30);
    const cy = r.range(30, H - 30);
    const rx = r.range(20, 70);
    const ry = r.range(30, 110);
    for (const [ctx, style] of [
      [p.o, 'rgb(255,13,0)'],
      [p.h, gray(0.44)],
      [p.a, 'rgba(10,12,14,0.6)'],
    ] as [Ctx, string][]) {
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, r.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Lane dashes: worn white paint.
  for (const nx of laneDividers) {
    const x = nx * W;
    for (const y0 of [60, 426]) {
      p.rect(x - 7, y0, 14, 246, { albedo: '#b9b9b0', height: 0.53, rough: 0.45, metal: 0, puddle: 0 });
      p.speckle(x - 7, y0, 14, 246, 260, 0.5);
    }
  }
  // Edge lines in worn yellow.
  for (const x of [14, W - 14]) {
    p.rect(x - 6, 0, 12, H, { albedo: '#a98d2e', height: 0.53, rough: 0.45, metal: 0, puddle: 0 });
    p.speckle(x - 6, 0, 12, H, 600, 0.5);
  }
  // Manhole cover.
  const mx = W * 0.3;
  const my = H * 0.62;
  for (const [ctx, style] of [
    [p.a, '#3a3836'],
    [p.h, gray(0.55)],
    [p.o, 'rgb(0,90,200)'],
  ] as [Ctx, string][]) {
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.arc(mx, my, 38, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let k = -30; k <= 30; k += 8) p.rect(mx - 28, my + k, 56, 3, { albedo: '#262422', height: 0.45, rough: 0.4, metal: 0.8, puddle: 0 });
  return p.textures(2.2);
}

/** Concrete sidewalk slabs (2.4 m x 12 m). */
export function sidewalkSet() {
  const W = 256;
  const H = 1024;
  const p = new Painter(W, H, new Rng(5));
  const r = p.rng;
  p.rect(0, 0, W, H, { albedo: '#5d5b57', height: 0.5, rough: 0.75, metal: 0, puddle: 0 });
  p.speckle(0, 0, W, H, 6000, 0.15, 0.1);
  for (let y = 0; y <= H; y += 128) p.rect(0, y - 2, W, 4, { albedo: '#2f2e2c', height: 0.3, rough: 0.9, metal: 0, puddle: 0.3 });
  p.rect(W / 2 - 1, 0, 2, H, { albedo: '#3a3936', height: 0.35, rough: 0.9, metal: 0, puddle: 0.2 });
  for (let i = 0; i < 4; i++) {
    p.o.fillStyle = 'rgb(200,25,0)';
    p.o.beginPath();
    p.o.ellipse(r.range(20, W - 20), r.range(20, H - 20), r.range(15, 40), r.range(20, 60), 0, 0, Math.PI * 2);
    p.o.fill();
  }
  return p.textures(2);
}

// -----------------------------------------------------------------------------
// Props & FX
// -----------------------------------------------------------------------------

/** Neon blade-sign face: emissive letters on a dark board. */
export function signFace(word: string, neon: string): { albedo: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const W = 128;
  const H = 512;
  const [ca, a] = makeCanvas(W, H);
  const [ce, e] = makeCanvas(W, H);
  a.fillStyle = '#121418';
  a.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const step = H / (word.length + 0.5);
  for (const ctx of [a, e]) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.min(96, step * 0.8)}px "Arial Narrow", Arial, sans-serif`;
  }
  for (let i = 0; i < word.length; i++) {
    const y = step * (i + 0.75);
    e.shadowColor = neon;
    e.shadowBlur = 14;
    e.fillStyle = neon;
    e.fillText(word[i], W / 2, y);
    e.shadowBlur = 0;
    e.fillStyle = '#ffffff';
    e.globalAlpha = 0.6;
    e.fillText(word[i], W / 2, y);
    e.globalAlpha = 1;
    a.fillStyle = '#2a2e33';
    a.fillText(word[i], W / 2, y);
  }
  e.strokeStyle = neon;
  e.lineWidth = 5;
  e.strokeRect(8, 8, W - 16, H - 16);
  return { albedo: toTexture(ca, true, false), emissive: toTexture(ce, true, false) };
}

/** Weathered concrete for barriers. */
export function concreteSet() {
  const p = new Painter(256, 256, new Rng(77));
  p.rect(0, 0, 256, 256, { albedo: '#8a8780', height: 0.5, rough: 0.85, metal: 0 });
  p.speckle(0, 0, 256, 256, 4000, 0.15, 0.12);
  p.streaks(0, 0, 256, 256, 12);
  // Chips.
  for (let i = 0; i < 12; i++) p.rect(p.rng.range(0, 240), p.rng.range(0, 240), p.rng.range(4, 14), p.rng.range(3, 10), { albedo: '#6d6a64', height: 0.35, rough: 0.9, metal: 0 });
  return p.textures(3);
}

/** Wooden crate planks. */
export function woodSet() {
  const p = new Painter(256, 256, new Rng(91));
  const r = p.rng;
  for (let y = 0; y < 256; y += 32) {
    p.rect(0, y, 256, 32, { albedo: r.pick(['#6b5132', '#5e4629', '#7a5c38', '#664c2e']), height: 0.55, rough: 0.8, metal: 0 });
    p.rect(0, y, 256, 3, { albedo: '#2a1e12', height: 0.25, rough: 0.9, metal: 0 });
    for (let k = 0; k < 40; k++) p.rect(r.range(0, 256), y + r.range(4, 30), r.range(20, 80), 1, { albedo: 'rgba(30,20,10,0.4)' });
  }
  // Frame boards.
  p.rect(0, 0, 22, 256, { albedo: '#57422a', height: 0.8, rough: 0.8, metal: 0 });
  p.rect(234, 0, 22, 256, { albedo: '#57422a', height: 0.8, rough: 0.8, metal: 0 });
  p.streaks(0, 0, 256, 256, 6);
  return p.textures(3);
}

/** Car paint flake + body seams are geometric; tyres get a tread texture. */
export function hazardStripe(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(256, 32);
  g.fillStyle = '#141414';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#e0b234';
  for (let x = -32; x < 288; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.fill();
  }
  return toTexture(c, true);
}

/** Soft, noisy puff for steam / mist sprites. */
export function puffTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  const rng = new Rng(9);
  for (let i = 0; i < 30; i++) {
    const x = S / 2 + rng.range(-28, 28);
    const y = S / 2 + rng.range(-28, 28);
    const rad = rng.range(18, 40);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  return toTexture(c, true, false);
}

/** Vertical light-shaft gradient for lamp cones (bright at the top, fading out). */
export function shaftTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(64, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  // Soft horizontal falloff so the cone edges aren't hard.
  const img = g.getImageData(0, 0, 64, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 64; x++) {
      const f = 1 - Math.pow(Math.abs(x - 31.5) / 32, 2);
      img.data[(y * 64 + x) * 4 + 3] *= f;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, true, false);
}

/** Small radial glow (light halos, splash flecks). */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c, true, false);
}
