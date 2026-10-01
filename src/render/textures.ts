import * as THREE from 'three';
import { Rng } from '../core/rng';

/** Procedurally generated canvas textures (no external assets). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/**
 * Wet asphalt road with lane dashes. One tile covers the road width and
 * `tileLength` meters; lane dividers sit at the given normalized x positions.
 */
export function roadTexture(laneDividers: number[]): THREE.CanvasTexture {
  const [c, g] = canvas(256, 512);
  const rng = new Rng(7);
  g.fillStyle = '#181c1f';
  g.fillRect(0, 0, 256, 512);
  // Grain / aggregate speckle.
  for (let i = 0; i < 5000; i++) {
    const v = 18 + rng.int(0, 22);
    g.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
    g.fillRect(rng.int(0, 255), rng.int(0, 511), 2, 2);
  }
  // Darker puddle blotches (read as wet patches under the specular light).
  for (let i = 0; i < 14; i++) {
    g.fillStyle = 'rgba(5,8,10,0.45)';
    g.beginPath();
    g.ellipse(rng.range(0, 256), rng.range(0, 512), rng.range(10, 40), rng.range(20, 70), 0, 0, Math.PI * 2);
    g.fill();
  }
  // Lane dashes.
  g.fillStyle = 'rgba(200,205,190,0.55)';
  for (const nx of laneDividers) {
    const x = nx * 256;
    g.fillRect(x - 2, 40, 4, 180);
    g.fillRect(x - 2, 296, 4, 180);
  }
  // Edge lines.
  g.fillStyle = 'rgba(210,180,70,0.5)';
  g.fillRect(4, 0, 4, 512);
  g.fillRect(248, 0, 4, 512);
  return finish(c);
}

/** Concrete sidewalk slabs. */
export function sidewalkTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const rng = new Rng(11);
  g.fillStyle = '#2b3033';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 1500; i++) {
    const v = 36 + rng.int(0, 18);
    g.fillStyle = `rgb(${v},${v + 3},${v + 5})`;
    g.fillRect(rng.int(0, 127), rng.int(0, 255), 2, 2);
  }
  g.strokeStyle = 'rgba(10,12,14,0.8)';
  g.lineWidth = 2;
  for (let y = 0; y <= 256; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y);
    g.stroke();
  }
  return finish(c);
}

/** Soft radial blob used for light pools / glows on the ground. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Vertical streak (bright center, fading ends) for fake wet-ground neon reflections. */
export function streakTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(32, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 128);
  // Fade horizontally too, with a little ripple noise.
  const img = g.getImageData(0, 0, 32, 128);
  const rng = new Rng(3);
  for (let y = 0; y < 128; y++) {
    const ripple = 0.6 + 0.4 * rng.next();
    for (let x = 0; x < 32; x++) {
      const fx = 1 - Math.abs(x - 15.5) / 16;
      const i = (y * 32 + x) * 4 + 3;
      img.data[i] = img.data[i] * fx * fx * ripple;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Caution stripes for barriers. */
export function hazardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 32);
  g.fillStyle = '#1a1a1a';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#d9b23a';
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.fill();
  }
  return finish(c);
}
