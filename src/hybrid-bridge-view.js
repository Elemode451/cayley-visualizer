import * as THREE from 'three';
import { clamp, hslToRgb, modulo } from './math-utils.js';

export class HybridBridgeView {
  constructor({ scene, maxLinks = 2800 }) {
    this.maxLinks = maxLinks;
    this.linkPositions = new Float32Array(maxLinks * 2 * 3);
    this.linkColors = new Float32Array(maxLinks * 2 * 3);

    this.geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(this.linkPositions, 3);
    const colorAttr = new THREE.BufferAttribute(this.linkColors, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttr);
    this.geometry.setAttribute('color', colorAttr);
    this.geometry.setDrawRange(0, 0);

    this.lines = new THREE.LineSegments(
      this.geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
      })
    );
    this.lines.visible = false;
    scene.add(this.lines);
  }

  update({ originalTorus, freeFlower, frame, elapsed, alpha }) {
    if (alpha <= 0.01) {
      this.lines.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }

    const snapshot = freeFlower.getActiveNodeSnapshot();
    if (!snapshot || snapshot.count <= 1) {
      this.lines.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }

    const stride = Math.max(1, Math.floor(snapshot.count / this.maxLinks));
    const localAlpha = clamp(alpha, 0, 1);
    const pulse = 0.34 + frame.beatPulse * 0.72 + frame.bassEnergy * 0.44;
    const torusPoint = [0, 0, 0];
    let linkCount = 0;

    for (let i = 1; i < snapshot.count; i += stride) {
      const nodeId = snapshot.ids[i];
      const sourceOffset = nodeId * 3;
      const x = snapshot.world[sourceOffset];
      const y = snapshot.world[sourceOffset + 1];
      const z = snapshot.world[sourceOffset + 2];

      if (!Number.isFinite(x + y + z)) {
        continue;
      }

      originalTorus.sampleSurfacePointFromWorld(x, y, z, torusPoint);
      const targetOffset = linkCount * 6;
      this.linkPositions[targetOffset] = x;
      this.linkPositions[targetOffset + 1] = y;
      this.linkPositions[targetOffset + 2] = z;
      this.linkPositions[targetOffset + 3] = torusPoint[0];
      this.linkPositions[targetOffset + 4] = torusPoint[1];
      this.linkPositions[targetOffset + 5] = torusPoint[2];

      const hue = modulo(0.08 + (i / snapshot.count) * 0.42 + elapsed * 0.02, 1);
      const [r, g, b] = hslToRgb(hue, 0.86, clamp(0.32 + pulse * 0.4, 0, 1));
      this.linkColors[targetOffset] = r * 0.55;
      this.linkColors[targetOffset + 1] = g * 0.55;
      this.linkColors[targetOffset + 2] = b * 0.55;
      this.linkColors[targetOffset + 3] = r;
      this.linkColors[targetOffset + 4] = g;
      this.linkColors[targetOffset + 5] = b;

      linkCount += 1;
      if (linkCount >= this.maxLinks) {
        break;
      }
    }

    this.geometry.setDrawRange(0, linkCount * 2);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;

    this.lines.material.opacity = 0.08 + localAlpha * (0.28 + frame.beatPulse * 0.5);
    this.lines.visible = linkCount > 0;
  }

  setBlend(alpha) {
    const a = clamp(alpha, 0, 1);
    this.lines.material.opacity = 0.08 + a * 0.32;
    this.lines.visible = a > 0.01;
  }
}
