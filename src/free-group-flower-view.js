import * as THREE from 'three';
import { clamp, hslToRgb, modulo, TWO_PI } from './math-utils.js';

const INVERSE = {
  a: 'A',
  A: 'a',
  b: 'B',
  B: 'b',
};

const GENERATORS = ['a', 'A', 'b', 'B'];

export class FreeGroupFlowerView {
  constructor({ scene, majorRadius, tubeRadius, maxDepth = 6 }) {
    this.majorRadius = majorRadius;
    this.tubeRadius = tubeRadius;
    this.maxDepth = maxDepth;
    this.loopU = 18;
    this.loopV = 14;
    this.growth = 0;
    this.builtDepth = 0;

    this.maxNodes = this.computeMaxNodes(maxDepth);
    this.nodes = [];
    this.nodesByDepth = [];
    this.nodeWorld = new Float32Array(this.maxNodes * 3);

    this.pointPositions = new Float32Array(this.maxNodes * 3);
    this.pointColors = new Float32Array(this.maxNodes * 3);
    this.edgePositions = new Float32Array((this.maxNodes - 1) * 2 * 3);
    this.edgeColors = new Float32Array((this.maxNodes - 1) * 2 * 3);

    this.group = new THREE.Group();
    scene.add(this.group);

    this.edgeGeometry = new THREE.BufferGeometry();
    this.edgeGeometry.setAttribute('position', new THREE.BufferAttribute(this.edgePositions, 3));
    this.edgeGeometry.setAttribute('color', new THREE.BufferAttribute(this.edgeColors, 3));
    this.edgeGeometry.setDrawRange(0, 0);
    this.edgeLines = new THREE.LineSegments(
      this.edgeGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
      })
    );
    this.group.add(this.edgeLines);

    this.pointGeometry = new THREE.BufferGeometry();
    this.pointGeometry.setAttribute('position', new THREE.BufferAttribute(this.pointPositions, 3));
    this.pointGeometry.setAttribute('color', new THREE.BufferAttribute(this.pointColors, 3));
    this.pointGeometry.setDrawRange(0, 0);
    this.pointCloud = new THREE.Points(
      this.pointGeometry,
      new THREE.PointsMaterial({
        size: 0.12,
        vertexColors: true,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.group.add(this.pointCloud);

    this.nodes.push({
      parent: -1,
      depth: 0,
      lastGen: null,
      aCount: 0,
      bCount: 0,
      seed: 0.13,
    });
    this.nodesByDepth[0] = [0];
  }

  update(elapsed, frame, active = false) {
    const drive = clamp(frame.bassEnergy * 1.7 + frame.spectralFlux * 2.2 + frame.beatPulse * 0.9, 0, 1.8);
    const beatBoost = frame.beat ? 0.2 : 0;
    if (frame.hasSignal) {
      this.growth = clamp(this.growth * 0.96 + drive * 0.08 + beatBoost, 0, this.maxDepth + 0.999);
    } else {
      this.growth *= 0.985;
    }

    // Ensure the free-group graph is visibly formed when this mode is selected.
    if (active) {
      this.growth = Math.max(this.growth, 2.25);
    }

    const desiredDepth = Math.min(this.maxDepth, Math.floor(this.growth));
    while (this.builtDepth < desiredDepth) {
      this.expandOneDepth();
    }

    this.group.rotation.z += 0.0008 + frame.beatPulse * 0.004;
    this.group.rotation.x = 0.24 + Math.sin(elapsed * 0.15) * 0.14;
    this.group.rotation.y = Math.cos(elapsed * 0.11) * 0.16;
    const scale = 0.96 + clamp(this.growth / this.maxDepth, 0, 1) * 0.3;
    this.group.scale.setScalar(scale);

    this.rebuildGeometry(desiredDepth, elapsed, frame);
  }

  setBlend(alpha) {
    const a = clamp(alpha, 0, 1);
    this.edgeLines.material.opacity = 0.06 + a * 0.72;
    this.pointCloud.material.opacity = 0.1 + a * 0.86;
    this.group.visible = a > 0.01;
  }

  expandOneDepth() {
    const nextDepth = this.builtDepth + 1;
    const current = this.nodesByDepth[this.builtDepth] || [];
    const next = [];

    for (const nodeIndex of current) {
      const parent = this.nodes[nodeIndex];
      for (const gen of GENERATORS) {
        if (parent.lastGen && INVERSE[parent.lastGen] === gen) {
          continue;
        }

        const child = {
          parent: nodeIndex,
          depth: nextDepth,
          lastGen: gen,
          aCount: parent.aCount + this.generatorA(gen),
          bCount: parent.bCount + this.generatorB(gen),
          seed: this.seedFrom(parent.seed, gen, nextDepth),
        };
        const id = this.nodes.length;
        this.nodes.push(child);
        next.push(id);
      }
    }

    this.nodesByDepth[nextDepth] = next;
    this.builtDepth = nextDepth;
  }

  rebuildGeometry(activeDepth, elapsed, frame) {
    let pointCount = 0;
    let edgeCount = 0;

    for (let i = 0; i < this.nodes.length; i += 1) {
      const node = this.nodes[i];
      if (node.depth > activeDepth) {
        continue;
      }

      const { x, y, z, r, g, b } = this.projectNode(node, elapsed, frame);
      const worldOffset = i * 3;
      this.nodeWorld[worldOffset] = x;
      this.nodeWorld[worldOffset + 1] = y;
      this.nodeWorld[worldOffset + 2] = z;

      const pointOffset = pointCount * 3;
      this.pointPositions[pointOffset] = x;
      this.pointPositions[pointOffset + 1] = y;
      this.pointPositions[pointOffset + 2] = z;
      this.pointColors[pointOffset] = r;
      this.pointColors[pointOffset + 1] = g;
      this.pointColors[pointOffset + 2] = b;
      pointCount += 1;

      if (node.parent >= 0) {
        const parent = this.nodes[node.parent];
        if (parent.depth > activeDepth) {
          continue;
        }

        const edgeOffset = edgeCount * 6;
        const parentOffset = node.parent * 3;

        this.edgePositions[edgeOffset] = this.nodeWorld[parentOffset];
        this.edgePositions[edgeOffset + 1] = this.nodeWorld[parentOffset + 1];
        this.edgePositions[edgeOffset + 2] = this.nodeWorld[parentOffset + 2];
        this.edgePositions[edgeOffset + 3] = x;
        this.edgePositions[edgeOffset + 4] = y;
        this.edgePositions[edgeOffset + 5] = z;

        this.edgeColors[edgeOffset] = r * 0.7;
        this.edgeColors[edgeOffset + 1] = g * 0.7;
        this.edgeColors[edgeOffset + 2] = b * 0.7;
        this.edgeColors[edgeOffset + 3] = r;
        this.edgeColors[edgeOffset + 4] = g;
        this.edgeColors[edgeOffset + 5] = b;
        edgeCount += 1;
      }
    }

    this.pointGeometry.setDrawRange(0, pointCount);
    this.pointGeometry.attributes.position.needsUpdate = true;
    this.pointGeometry.attributes.color.needsUpdate = true;

    this.edgeGeometry.setDrawRange(0, edgeCount * 2);
    this.edgeGeometry.attributes.position.needsUpdate = true;
    this.edgeGeometry.attributes.color.needsUpdate = true;
  }

  projectNode(node, elapsed, frame) {
    const depthNorm = node.depth / Math.max(1, this.maxDepth);
    const bandCount = frame.bandAmpSmooth.length;
    const bandIndex = Math.min(bandCount - 1, Math.floor(depthNorm * (bandCount - 1)));
    const bandAmp = frame.bandAmpSmooth[bandIndex] || 0;
    const bandPhase = frame.bandPhase[bandIndex] || 0;

    const theta =
      (TWO_PI * modulo(node.aCount, this.loopU)) / this.loopU + elapsed * 0.13 + node.seed * 0.9 + depthNorm * 0.6;
    const phi =
      (TWO_PI * modulo(node.bCount, this.loopV)) / this.loopV -
      elapsed * 0.09 +
      node.seed * 0.7 +
      Math.sin(elapsed * 0.4 + node.seed * 3) * 0.15;

    const blossom =
      depthNorm * (0.48 + frame.bassEnergy * 1.3) +
      bandAmp * 1.2 +
      frame.beatPulse * 0.22 +
      Math.sin(elapsed * 1.05 + node.seed * 8.3 + node.depth * 0.7) * (0.08 + frame.beatPulse * 0.16);
    const radial = this.tubeRadius + blossom;

    const x = (this.majorRadius + radial * Math.cos(phi)) * Math.cos(theta);
    const y = (this.majorRadius + radial * Math.cos(phi)) * Math.sin(theta);
    const z = radial * Math.sin(phi) + Math.sin(theta * 2 + node.seed * 5) * depthNorm * 0.45;

    const hue = modulo(0.03 + depthNorm * 0.58 + bandPhase / TWO_PI + node.seed * 0.1, 1);
    const light = clamp(0.24 + bandAmp * 0.55 + frame.beatPulse * 0.16, 0, 1);
    const [r, g, b] = hslToRgb(hue, 0.82, light);
    return { x, y, z, r, g, b };
  }

  generatorA(gen) {
    if (gen === 'a') return 1;
    if (gen === 'A') return -1;
    return 0;
  }

  generatorB(gen) {
    if (gen === 'b') return 1;
    if (gen === 'B') return -1;
    return 0;
  }

  seedFrom(parentSeed, gen, depth) {
    const code = gen.charCodeAt(0);
    const raw = Math.sin(parentSeed * 12.9898 + code * 78.233 + depth * 5.937) * 43758.5453;
    return raw - Math.floor(raw);
  }

  computeMaxNodes(depth) {
    return 1 + 2 * (3 ** depth - 1);
  }
}
