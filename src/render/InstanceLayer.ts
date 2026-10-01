import * as THREE from 'three';

/**
 * One instanced scenery layer (= one draw call) whose instances are split into
 * fixed per-chunk-slot ranges. Recycling a chunk just rewrites its matrices.
 */

const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const IDENTITY_Q = new THREE.Quaternion();
/** Rotation that lays a PlaneGeometry flat on the ground (facing up). */
export const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export class InstanceLayer {
  readonly mesh: THREE.InstancedMesh;
  private used: number[];

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    readonly perSlot: number,
    slots: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, perSlot * slots);
    this.mesh.frustumCulled = false; // instances span the whole visible street
    this.used = new Array(slots).fill(0);
    for (let i = 0; i < perSlot * slots; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, _c.set(0xffffff));
    }
  }

  clear(slot: number): void {
    for (let k = 0; k < this.perSlot; k++) this.mesh.setMatrixAt(slot * this.perSlot + k, ZERO);
    this.used[slot] = 0;
    this.touch();
  }

  /** Add an instance to a slot; silently drops it if the slot's budget is full. */
  add(slot: number, pos: THREE.Vector3, scale: THREE.Vector3, color: number | THREE.Color, rot: THREE.Quaternion = IDENTITY_Q): boolean {
    const k = this.used[slot];
    if (k >= this.perSlot) return false;
    this.used[slot] = k + 1;
    const i = slot * this.perSlot + k;
    this.mesh.setMatrixAt(i, _m.compose(pos, rot, scale));
    this.mesh.setColorAt(i, typeof color === 'number' ? _c.set(color) : color);
    this.touch();
    return true;
  }

  private touch(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

