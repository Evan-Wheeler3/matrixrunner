import * as THREE from 'three';
import { CONFIG } from '../config';

const CAM = CONFIG.camera;

export interface ChaseTarget {
  x: number;
  y: number;
  /** Distance along the track (world z = -d). */
  d: number;
  speed: number;
  /** Normal running speed; FOV widens as speed exceeds it. */
  cruise: number;
}

/**
 * Fixed Temple-Run-style chase camera: behind and above the player, follows
 * lane changes with a slight lag. The only dynamic effects are speed-based FOV
 * and impact shake – the mouse never moves it.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private camX = 0;
  private shake = 0;
  private readonly look = new THREE.Vector3();

  constructor(aspect: number, far = 260) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.render.fov, aspect, 0.1, far);
  }

  addShake(amount: number): void {
    this.shake = Math.min(CAM.shakeMax, this.shake + amount);
  }

  update(dt: number, t: ChaseTarget): void {
    const pz = -t.d;
    this.camX += (t.x * CAM.lateralFollow - this.camX) * Math.min(1, CAM.followLerp * dt);
    const shakeX = (Math.random() - 0.5) * this.shake;
    const shakeY = (Math.random() - 0.5) * this.shake;
    this.shake *= Math.exp(-CAM.shakeDecay * dt);

    const cam = this.camera;
    cam.position.set(this.camX + CAM.offset.x + shakeX, CAM.offset.y + t.y * 0.45 + shakeY, pz + CAM.offset.z);
    this.look.set(this.camX * 0.6, CAM.lookAhead.y + t.y * 0.3, pz + CAM.lookAhead.z);
    cam.lookAt(this.look);

    const speedRatio = t.cruise > 0 ? t.speed / t.cruise : 1;
    const targetFov = CONFIG.render.fov + CONFIG.render.fovSpeedBoost * THREE.MathUtils.clamp(speedRatio - 1, -0.3, 1);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
