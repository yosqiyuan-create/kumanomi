// Clownfish egg clutch on a rock: orange at first, darker later, silver eyes before hatching
import * as THREE from 'three';
import { addCaustics } from './env.js';

const MAX = 180;

export class EggCluster {
  constructor(scene, spot) {
    this.spot = spot;
    const geo = new THREE.SphereGeometry(0.011, 6, 4);
    geo.scale(1, 0.8, 1.25);
    const mat = addCaustics(new THREE.MeshStandardMaterial({ roughness: 0.35, emissive: new THREE.Color(0.12, 0.05, 0.0) }), 0.6);
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // lay the eggs out in a tight oval patch on the rock surface
    const n = spot.n.clone().normalize();
    const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const m4 = new THREE.Matrix4();
    this.order = [];
    for (let i = 0; i < MAX; i++) {
      // random but tightly packed oval patch, like a real clutch
      const r = Math.sqrt(Math.random()) * (0.9 + Math.random() * 0.1), a = Math.random() * Math.PI * 2;
      const p = spot.p.clone().addScaledVector(t1, Math.cos(a) * r * 0.1).addScaledVector(t2, Math.sin(a) * r * 0.07).addScaledVector(n, 0.005 + Math.random() * 0.006);
      const sc = 0.85 + Math.random() * 0.3;
      m4.compose(p, q, new THREE.Vector3(sc, sc, sc));
      this.mesh.setMatrixAt(i, m4);
      this.order.push(i);
    }
    this.cOrange = new THREE.Color('#ff7a1a');
    this.cBrown = new THREE.Color('#8a4a1a');
    this.cSilver = new THREE.Color('#d8e2e6');
    this._c = new THREE.Color();
  }

  // info: { eggs, laid, progress } or null
  update(info) {
    if (!info) { this.mesh.count = 0; return; }
    const k = Math.max(0, Math.min(1, info.eggs / Math.max(1, info.laid)));
    this.mesh.count = Math.max(6, Math.round(MAX * k));
    const p = info.progress;
    for (let i = 0; i < this.mesh.count; i++) {
      const c = this._c.copy(this.cOrange).lerp(this.cBrown, Math.min(1, p * 1.4));
      // eyes show up near the end: some eggs flash silver
      if (p > 0.7 && (i * 7919) % 3 === 0) c.lerp(this.cSilver, (p - 0.7) / 0.3 * 0.8);
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
