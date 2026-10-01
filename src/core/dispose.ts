import * as THREE from 'three';

/** Free GPU resources for everything under `root` (geometries, materials, textures). */
export function disposeObject(root: THREE.Object3D): void {
  const seen = new Set<unknown>();
  const free = (thing: { dispose(): void } | null | undefined) => {
    if (!thing || seen.has(thing)) return;
    seen.add(thing);
    thing.dispose();
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) free(mesh.geometry);
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) free(value);
      }
      free(m);
    }
  });
}
