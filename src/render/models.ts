import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE, flatMat, glowMat } from './palette';
import { concreteSet, woodSet, hazardStripe, puffTexture } from './look/textures';
import { FX_LAYER } from './look/materials';

/**
 * Obstacles and set pieces. Characters live in ./characters.ts and are
 * re-exported here so gameplay code has one import site for models.
 */
export { buildRunner, buildAgent, animateHumanoid, type Humanoid, type Pose } from './characters';

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

function emissiveMat(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

/** LED board texture: amber chevrons + text. */
function ledBoard(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#ffb12e';
  // Dot-matrix look: draw text then mask with a dot grid.
  g.font = 'bold 64px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  for (let i = 0; i < 3; i++) {
    for (const dir of [-1, 1]) {
      const x = 256 + dir * (170 + i * 26);
      g.beginPath();
      g.moveTo(x - dir * 10, 34);
      g.lineTo(x + dir * 10, 64);
      g.lineTo(x - dir * 10, 94);
      g.lineWidth = 9;
      g.strokeStyle = '#ffb12e';
      g.stroke();
    }
  }
  const img = g.getImageData(0, 0, 512, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 512; x++) {
      if (x % 6 > 3 || y % 6 > 3) {
        const i = (y * 512 + x) * 4;
        img.data[i] *= 0.15;
        img.data[i + 1] *= 0.15;
        img.data[i + 2] *= 0.15;
      }
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shared materials for obstacles (built once, reused by every pooled instance). */
export class ObstacleMaterials {
  readonly concrete: THREE.Material;
  readonly hazard: THREE.Material;
  readonly wood: THREE.Material;
  readonly metal = flatMat(PALETTE.metal, { roughness: 0.35, metalness: 0.85 });
  readonly darkMetal = flatMat(0x1c1f22, { roughness: 0.45, metalness: 0.8 });
  readonly scaffold = flatMat(0x8a8f92, { roughness: 0.4, metalness: 0.9 });
  readonly carPaint: THREE.Material[];
  readonly carGlass = flatMat(0x06090c, { roughness: 0.04, metalness: 0.6, envMapIntensity: 1.6 });
  readonly tyre = flatMat(0x0d0d0e, { roughness: 0.85 });
  readonly rim = flatMat(0xa9b0b5, { roughness: 0.25, metalness: 1 });
  readonly chrome = flatMat(0xd0d6da, { roughness: 0.15, metalness: 1 });
  readonly headlight = emissiveMat(0xfff1d2, 4);
  readonly taillight = emissiveMat(0xff2a24, 3.2);
  readonly beacon = emissiveMat(0xffa21f, 4);
  readonly led: THREE.MeshStandardMaterial;
  readonly grate = flatMat(0x222527, { roughness: 0.5, metalness: 0.85 });
  readonly steam: THREE.SpriteMaterial;

  constructor() {
    const c = concreteSet();
    this.concrete = flatMat(0xffffff, { map: c.albedo, normalMap: c.normal, roughness: 0.85 });
    this.hazard = flatMat(0xffffff, { map: hazardStripe(), roughness: 0.5, emissive: 0xffffff, emissiveMap: hazardStripe(), emissiveIntensity: 0.18 });
    const w = woodSet();
    this.wood = flatMat(0xffffff, { map: w.albedo, normalMap: w.normal, roughness: 0.8 });
    this.carPaint = PALETTE.cars.map((col) => flatMat(col, { roughness: 0.22, metalness: 0.6, envMapIntensity: 1.3 }));
    this.led = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: ledBoard('DETOUR'), emissiveIntensity: 2.6, roughness: 0.3 });
    this.steam = new THREE.SpriteMaterial({ map: puffTexture(), color: 0x9fb2ae, transparent: true, opacity: 0.22, depthWrite: false });
  }

  /** Blink beacons etc. */
  update(time: number): void {
    this.beacon.emissiveIntensity = Math.sin(time * 6) > 0.2 ? 5 : 0.2;
  }
}

/** Jersey barrier (low – tap jump). Extruded concrete profile with a reflective stripe. */
export function buildBarrierLow(m: ObstacleMaterials, width: number): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0.3, 0.08);
  s.lineTo(0.13, 0.3);
  s.lineTo(0.1, 0.8);
  s.lineTo(-0.1, 0.8);
  s.lineTo(-0.13, 0.3);
  s.lineTo(-0.3, 0.08);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: width - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.025, bevelSegments: 3, curveSegments: 1 });
  geo.translate(0, 0, -(width - 0.08) / 2);
  geo.rotateY(Math.PI / 2);
  g.add(new THREE.Mesh(geo, m.concrete));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.96, 0.12, 0.02), m.hazard);
  stripe.position.set(0, 0.55, 0.12);
  stripe.rotation.x = -0.06;
  g.add(stripe);
  return shadowed(g);
}

/** Stacked wooden crates (high – held jump) with a blinking beacon. */
export function buildCrateHigh(m: ObstacleMaterials, width: number): THREE.Group {
  const g = new THREE.Group();
  const w = width * 0.48;
  const crate = (cw: number, ch: number, cd: number) => new THREE.Mesh(new RoundedBoxGeometry(cw, ch, cd, 2, 0.03), m.wood);
  const a = crate(w, 0.6, 0.85);
  a.position.set(-w / 2 - 0.02, 0.3, 0);
  const b = crate(w, 0.6, 0.85);
  b.position.set(w / 2 + 0.02, 0.3, 0.03);
  b.rotation.y = 0.05;
  const c = crate(w * 1.1, 0.55, 0.8);
  c.position.set(0.05, 0.875, 0);
  c.rotation.y = -0.07;
  g.add(a, b, c);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 12), m.beacon);
  beacon.position.set(0.3, 1.21, 0);
  g.add(beacon);
  return shadowed(g);
}

/** Scaffold gantry with a lit LED board – slide under the bar. */
export function buildOverhead(m: ObstacleMaterials, span: number): THREE.Group {
  const g = new THREE.Group();
  const pipe = (len: number, r = 0.045) => new THREE.CylinderGeometry(r, r, len, 10);
  for (const x of [-span / 2, span / 2]) {
    for (const z of [-0.25, 0.25]) {
      const p = new THREE.Mesh(pipe(3.6), m.scaffold);
      p.position.set(x, 1.8, z);
      g.add(p);
    }
    const brace = new THREE.Mesh(pipe(0.6, 0.03), m.scaffold);
    brace.rotation.x = Math.PI / 2;
    brace.position.set(x, 0.4, 0);
    g.add(brace);
  }
  // The bar you slide under (bottom ~1.05 m), wrapped in hazard tape.
  const bar = new THREE.Mesh(pipe(span, 0.08), m.hazard);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.13, 0.25);
  g.add(bar);
  const top = new THREE.Mesh(pipe(span + 0.2, 0.05), m.scaffold);
  top.rotation.z = Math.PI / 2;
  top.position.set(0, 3.5, 0);
  g.add(top);
  // LED board.
  const board = new THREE.Mesh(new RoundedBoxGeometry(Math.min(span * 0.85, 4.2), 0.9, 0.16, 2, 0.03), m.darkMetal);
  board.position.set(0, 2.25, 0.05);
  g.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(span * 0.85, 4.2) - 0.12, 0.78), m.led);
  face.position.set(0, 2.25, 0.135);
  g.add(face);
  return shadowed(g);
}

/** Parked sedan facing away from the player (tail lights toward +z). */
export function buildCar(m: ObstacleMaterials, variant: number): THREE.Group {
  const g = new THREE.Group();
  // Side profile in (z, y); front at -z.
  const body = new THREE.Shape();
  const pts: [number, number][] = [
    [-2.12, 0.32], [-2.15, 0.72], [-1.95, 0.84], [-1.05, 0.95], [-0.52, 1.36], [0.62, 1.4], [1.32, 1.0], [2.02, 0.93], [2.13, 0.78], [2.12, 0.32],
  ];
  body.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) body.lineTo(x, y);
  body.closePath();
  const width = 1.66;
  const bodyGeo = new THREE.ExtrudeGeometry(body, { depth: width, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 4, curveSegments: 1 });
  bodyGeo.translate(0, 0, -width / 2);
  bodyGeo.rotateY(-Math.PI / 2); // profile x -> world z
  g.add(new THREE.Mesh(bodyGeo, m.carPaint[variant % m.carPaint.length]));

  // Glass greenhouse, slightly proud of the body.
  const glass = new THREE.Shape();
  glass.moveTo(-0.95, 0.99);
  glass.lineTo(-0.5, 1.33);
  glass.lineTo(0.6, 1.37);
  glass.lineTo(1.24, 1.02);
  glass.closePath();
  const gw = width + 0.17;
  const glassGeo = new THREE.ExtrudeGeometry(glass, { depth: gw, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  glassGeo.translate(0, 0.005, -gw / 2);
  glassGeo.rotateY(-Math.PI / 2);
  g.add(new THREE.Mesh(glassGeo, m.carGlass));

  // Wheels: tyre + rim + hub.
  const tyreGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 24);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.25, 16);
  rimGeo.rotateZ(Math.PI / 2);
  for (const x of [-0.84, 0.84]) {
    for (const z of [-1.33, 1.38]) {
      const t = new THREE.Mesh(tyreGeo, m.tyre);
      t.position.set(x, 0.34, z);
      const r = new THREE.Mesh(rimGeo, m.rim);
      r.position.set(x + Math.sign(x) * 0.01, 0.34, z);
      g.add(t, r);
    }
  }
  // Lights + bumpers + plate.
  const lamp = (w: number, h: number) => new RoundedBoxGeometry(w, h, 0.06, 1, 0.02);
  for (const side of [-1, 1]) {
    const tl = new THREE.Mesh(lamp(0.42, 0.13), m.taillight);
    tl.position.set(side * 0.62, 0.78, 2.18);
    const hl = new THREE.Mesh(lamp(0.36, 0.12), m.headlight);
    hl.position.set(side * 0.6, 0.7, -2.2);
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.08, 0.16, 1, 0.02), m.carPaint[variant % m.carPaint.length]);
    mirror.position.set(side * 0.98, 1.0, -0.62);
    g.add(tl, hl, mirror);
  }
  for (const z of [-2.22, 2.2]) {
    const bumper = new THREE.Mesh(new RoundedBoxGeometry(1.75, 0.16, 0.12, 2, 0.05), m.darkMetal);
    bumper.position.set(0, 0.42, z);
    g.add(bumper);
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.12), flatMat(0xd8d6c8, { roughness: 0.5 }));
  plate.position.set(0, 0.56, 2.27);
  g.add(plate);
  return shadowed(g);
}

/** Steam vent: grate + a rising plume of soft sprites (child 'plume'). */
export function buildVent(m: ObstacleMaterials): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.08, 1.4, 1, 0.02), m.grate);
  frame.position.y = 0.03;
  g.add(frame);
  for (let i = -5; i <= 5; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 1.3), m.darkMetal);
    bar.position.set(i * 0.13, 0.08, 0);
    g.add(bar);
  }
  shadowed(g);
  const plume = new THREE.Group();
  plume.name = 'plume';
  const sprites: THREE.Sprite[] = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(m.steam);
    s.layers.set(FX_LAYER);
    s.userData.offset = i / 9;
    plume.add(s);
    sprites.push(s);
  }
  // Called by Track each frame: sprites rise, grow and fade; `on` drives density.
  let density = 0;
  plume.userData.update = (dt: number, time: number, on: boolean) => {
    density += ((on ? 1 : 0.05) - density) * Math.min(1, dt * 6);
    for (const s of sprites) {
      const k = (time * 0.6 + s.userData.offset) % 1;
      const size = (0.6 + k * 1.8) * density;
      s.position.set(Math.sin(k * 6 + s.userData.offset * 10) * 0.2, 0.2 + k * 3.0, Math.cos(k * 5) * 0.15);
      s.scale.set(size, size, 1);
    }
  };
  g.add(plume);
  return g;
}

/** End-of-level payphone booth with a lit sign. */
export function buildPayphone(): THREE.Group {
  const g = new THREE.Group();
  const frame = flatMat(0x2a3136, { roughness: 0.35, metalness: 0.85 });
  const glass = flatMat(0x8fd8c4, { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.2, depthWrite: false });
  const w = 1.3;
  const h = 2.5;
  for (const x of [-w / 2, w / 2]) {
    for (const z of [-w / 2, w / 2]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.08, h, 0.08, 1, 0.02), frame);
      post.position.set(x, h / 2, z);
      g.add(post);
    }
  }
  const roof = new THREE.Mesh(new RoundedBoxGeometry(w + 0.16, 0.14, w + 0.16, 2, 0.04), frame);
  roof.position.y = h + 0.07;
  g.add(roof);
  const panes: [number, number, number, number][] = [
    [0, -w / 2, w, 0.02],
    [-w / 2, 0, 0.02, w],
    [w / 2, 0, 0.02, w],
  ];
  for (const [x, z, pw, pd] of panes) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(pw, h - 0.4, pd), glass);
    p.position.set(x, h / 2 + 0.1, z);
    g.add(p);
  }
  // Phone unit: body, handset, keypad glow, cord.
  const unit = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.6, 0.16, 2, 0.03), flatMat(0x3b4247, { roughness: 0.4, metalness: 0.7 }));
  unit.position.set(0, 1.45, -w / 2 + 0.1);
  g.add(unit);
  const handset = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.22, 4, 10), flatMat(0x111214, { roughness: 0.3 }));
  handset.position.set(-0.13, 1.5, -w / 2 + 0.2);
  g.add(handset);
  const keypad = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18), emissiveMat(0x7dffc4, 1.5));
  keypad.position.set(0.06, 1.38, -w / 2 + 0.181);
  g.add(keypad);
  // Sign.
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#5dffa8';
  ctx.font = 'bold 44px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PHONE', 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.1, 0.3, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 3 }),
  );
  sign.position.set(0, h + 0.32, w / 2);
  g.add(sign);
  const light = new THREE.PointLight(PALETTE.neon.green, 8, 10, 1.6);
  light.position.set(0, h - 0.3, 0);
  g.add(light);
  shadowed(g);
  return g;
}

export { glowMat };
