// Fish food pellets: float briefly, sink, rest on the sand
import * as THREE from 'three';
import { addCaustics, WATER_TOP } from './env.js';
import { sandHeight } from './noise.js';

export class FoodSystem {
  constructor(scene, obstacles, max = 80) {
    this.max = max;
    this.obstacles = obstacles;
    this.pellets = [];
    this.rotted = 0; // uneaten pellets that dissolved
    const geo = new THREE.IcosahedronGeometry(0.045, 1);
    const mat = addCaustics(new THREE.MeshStandardMaterial({ color: '#c8602a', roughness: 0.6, emissive: new THREE.Color('#5a2008') }), 0.5);
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
  }

  // y: height where the food appears (inside the visible area)
  drop(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) {
      if (this.pellets.length >= this.max) this.pellets.shift();
      this.pellets.push({
        pos: new THREE.Vector3(x + (Math.random() - 0.5) * 0.45, Math.min(WATER_TOP, y + (Math.random() - 0.5) * 0.25), z + (Math.random() - 0.5) * 0.4),
        alive: true, age: 0, float: Math.random() * 0.3, sink: 0.3 + Math.random() * 0.1,
        ph: Math.random() * 6.28, landed: false, landedAt: 0,
      });
    }
  }

  eat(p) { p.alive = false; if (this.onEat) this.onEat(); }

  update(dt, t) {
    for (const p of this.pellets) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.landed) {
        if (p.age - p.landedAt > 45) { p.alive = false; this.rotted++; }
        continue;
      }
      if (p.age < p.float) {
        p.pos.x += Math.sin(t * 2 + p.ph) * 0.002;
        continue;
      }
      p.pos.y -= p.sink * dt;
      p.pos.x += Math.sin(t * 1.3 + p.ph) * 0.06 * dt;
      p.pos.z += Math.cos(t * 1.1 + p.ph) * 0.05 * dt;
      let ground = sandHeight(p.pos.x, p.pos.z) + 0.02;
      for (const o of this.obstacles) {
        const dx = p.pos.x - o.c.x, dz = p.pos.z - o.c.z;
        const h2 = o.r * o.r * 0.7 - dx * dx - dz * dz;
        if (h2 > 0) ground = Math.max(ground, o.c.y + Math.sqrt(h2) * 0.8);
      }
      if (p.pos.y <= ground) { p.pos.y = ground; p.landed = true; p.landedAt = p.age; }
    }
    this.pellets = this.pellets.filter((p) => p.alive);
    let k = 0;
    for (const p of this.pellets) {
      this._m.makeTranslation(p.pos.x, p.pos.y, p.pos.z);
      this.mesh.setMatrixAt(k++, this._m);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
