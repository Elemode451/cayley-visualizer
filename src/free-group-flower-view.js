import * as THREE from 'three';
import { clamp, hslToRgb, modulo, TWO_PI } from './math-utils.js';

export class FreeGroupFlowerView {
  constructor({ scene, majorRadius, tubeRadius, maxDepth = 6, baseGenerators = ['a', 'b'], vectorDimensions = 3 }) {
    this.majorRadius = majorRadius;
    this.tubeRadius = tubeRadius;
    this.maxDepth = maxDepth;
    this.baseStep = 0.62;
    this.growth = 0;
    this.builtDepth = 0;

    const groupSpec = buildFreeGroupSystem(baseGenerators, vectorDimensions);
    this.baseGenerators = groupSpec.baseGenerators;
    this.generators = groupSpec.generators;
    this.inverseMap = groupSpec.inverseMap;
    this.symbolMeta = groupSpec.symbolMeta;
    this.directionMap = groupSpec.directionMap;

    this.loopU = 18;
    this.loopV = 14;
    this.maxNodes = this.computeMaxNodes(maxDepth);
    this.nodes = [];
    this.nodesByDepth = [];
    this.nodeWorld = new Float32Array(this.maxNodes * 3);
    this.activeNodeIds = new Uint32Array(this.maxNodes);
    this.activeNodeCount = 0;

    this.pointPositions = new Float32Array(this.maxNodes * 3);
    this.pointColors = new Float32Array(this.maxNodes * 3);
    this.edgePositions = new Float32Array((this.maxNodes - 1) * 2 * 3);
    this.edgeColors = new Float32Array((this.maxNodes - 1) * 2 * 3);

    this.group = new THREE.Group();
    scene.add(this.group);

    this.edgeGeometry = new THREE.BufferGeometry();
    const edgePositionAttr = new THREE.BufferAttribute(this.edgePositions, 3);
    const edgeColorAttr = new THREE.BufferAttribute(this.edgeColors, 3);
    edgePositionAttr.setUsage(THREE.DynamicDrawUsage);
    edgeColorAttr.setUsage(THREE.DynamicDrawUsage);
    this.edgeGeometry.setAttribute('position', edgePositionAttr);
    this.edgeGeometry.setAttribute('color', edgeColorAttr);
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
    const pointPositionAttr = new THREE.BufferAttribute(this.pointPositions, 3);
    const pointColorAttr = new THREE.BufferAttribute(this.pointColors, 3);
    pointPositionAttr.setUsage(THREE.DynamicDrawUsage);
    pointColorAttr.setUsage(THREE.DynamicDrawUsage);
    this.pointGeometry.setAttribute('position', pointPositionAttr);
    this.pointGeometry.setAttribute('color', pointColorAttr);
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
      seed: 0.13,
      tx: 0,
      ty: 0,
      tz: 0,
      counts: new Int16Array(this.baseGenerators.length),
    });
    this.nodesByDepth[0] = [0];
  }

  update(elapsed, frame, options = {}) {
    const active = Boolean(options.active);
    const formMode = options.formMode || 'projected';
    const freeze = Boolean(options.freeze);
    if (freeze) {
      return;
    }

    const drive = clamp(frame.bassEnergy * 2.5 + frame.spectralFlux * 3.2 + frame.beatPulse * 1.4, 0, 2.6);
    if (frame.hasSignal) {
      const rise = drive * 0.13 + (frame.beat ? 0.5 : 0.045);
      this.growth = clamp(this.growth + rise - 0.012, 0, this.maxDepth + 0.999);
    } else {
      this.growth = Math.max(0, this.growth - 0.02);
    }

    if (active) {
      this.growth = Math.max(this.growth, 3.4);
    }

    const effectiveGrowth = clamp(this.growth + frame.beatPulse * 1.2 + frame.spectralFlux * 1.5, 0, this.maxDepth + 0.999);
    const desiredDepth = Math.min(this.maxDepth, Math.floor(effectiveGrowth));
    while (this.builtDepth < desiredDepth) {
      this.expandOneDepth();
    }

    this.group.rotation.z += 0.0012 + frame.beatPulse * 0.0055;
    this.group.rotation.x = 0.32 + Math.sin(elapsed * 0.19) * 0.2 + frame.bassEnergy * 0.22;
    this.group.rotation.y = Math.cos(elapsed * 0.14) * 0.22;
    const scale = 0.92 + clamp(this.growth / this.maxDepth, 0, 1) * 0.48;
    this.group.scale.setScalar(scale);

    this.rebuildGeometry(desiredDepth, elapsed, frame, formMode);
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
      for (const gen of this.generators) {
        if (parent.lastGen && this.inverseMap[parent.lastGen] === gen) {
          continue;
        }

        const meta = this.symbolMeta[gen];
        const counts = parent.counts.slice();
        counts[meta.baseIndex] += meta.sign;

        const child = {
          parent: nodeIndex,
          depth: nextDepth,
          lastGen: gen,
          seed: this.seedFrom(parent.seed, gen, nextDepth),
          tx: 0,
          ty: 0,
          tz: 0,
          counts,
        };

        const dir = this.generatorVector(gen, parent.seed, nextDepth);
        const stepScale = this.baseStep + nextDepth * 0.05;
        child.tx = parent.tx + dir.x * stepScale;
        child.ty = parent.ty + dir.y * stepScale;
        child.tz = parent.tz + dir.z * stepScale;

        const id = this.nodes.length;
        this.nodes.push(child);
        next.push(id);
      }
    }

    this.nodesByDepth[nextDepth] = next;
    this.builtDepth = nextDepth;
  }

  rebuildGeometry(activeDepth, elapsed, frame, formMode) {
    let pointCount = 0;
    let edgeCount = 0;

    for (let i = 0; i < this.nodes.length; i += 1) {
      const node = this.nodes[i];
      if (node.depth > activeDepth) {
        continue;
      }

      const { x, y, z, r, g, b } = this.projectNode(node, elapsed, frame, formMode);
      const worldOffset = i * 3;
      this.nodeWorld[worldOffset] = x;
      this.nodeWorld[worldOffset + 1] = y;
      this.nodeWorld[worldOffset + 2] = z;
      this.activeNodeIds[pointCount] = i;

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
    this.activeNodeCount = pointCount;
  }

  projectNode(node, elapsed, frame, formMode) {
    const depthNorm = node.depth / Math.max(1, this.maxDepth);
    const bandCount = frame.bandAmpSmooth.length;
    const bandIndex = Math.min(bandCount - 1, Math.floor(depthNorm * (bandCount - 1)));
    const bandAmp = frame.bandAmpSmooth[bandIndex] || 0;
    const bandPhase = frame.bandPhase[bandIndex] || 0;

    const count0 = node.counts[0] || 0;
    const count1 = node.counts[Math.min(1, node.counts.length - 1)] || 0;
    let extraCount = 0;
    for (let i = 2; i < node.counts.length; i += 1) {
      extraCount += node.counts[i] * (i + 1);
    }

    const theta =
      (TWO_PI * modulo(count0, this.loopU)) / this.loopU +
      elapsed * 0.13 +
      node.seed * 0.9 +
      depthNorm * 0.6 +
      extraCount * 0.27;
    const phi =
      (TWO_PI * modulo(count1 + extraCount, this.loopV)) / this.loopV -
      elapsed * 0.09 +
      node.seed * 0.7 +
      Math.sin(elapsed * 0.4 + node.seed * 3) * 0.15 +
      extraCount * 0.19;

    const blossom =
      depthNorm * (0.58 + frame.bassEnergy * 1.7) +
      bandAmp * 1.2 +
      frame.beatPulse * 0.28 +
      Math.sin(elapsed * 1.05 + node.seed * 8.3 + node.depth * 0.7) * (0.1 + frame.beatPulse * 0.26);
    const radial = this.tubeRadius + blossom;

    const torusX = (this.majorRadius + radial * Math.cos(phi)) * Math.cos(theta);
    const torusY = (this.majorRadius + radial * Math.cos(phi)) * Math.sin(theta);
    const torusZ = radial * Math.sin(phi) + Math.sin(theta * 2 + node.seed * 5) * depthNorm * 0.8;

    const branchWave = Math.sin(elapsed * (0.8 + depthNorm * 0.9) + node.seed * 6);
    let treeX = node.tx * (0.56 + frame.bassEnergy * 0.3) + Math.cos(node.seed * TWO_PI) * branchWave * 0.08;
    let treeY = node.ty * (0.56 + frame.spectralFlux * 0.7) + Math.sin(node.seed * TWO_PI) * branchWave * 0.08;
    let treeZ = node.tz * (0.72 + frame.beatPulse * 0.8) + branchWave * (0.3 + depthNorm * 0.8);

    let torusProjection = clamp(
      (node.depth + this.growth * 0.42 + frame.bassEnergy * 2 + frame.beatPulse * 1.1) / (this.maxDepth * 1.2),
      0,
      1
    );
    torusProjection = torusProjection * torusProjection * (3 - 2 * torusProjection);
    if (node.depth === 0) {
      torusProjection = 0;
    }

    if (formMode === 'hybrid') {
      torusProjection *= 0.42;
    } else if (formMode === 'free') {
      torusProjection = 0;
    }

    if (formMode === 'free') {
      const beatWarp = frame.beatPulse * 1.2 + frame.bassEnergy * 0.45;
      const pulseX = Math.cos(elapsed * 2.5 + node.seed * 13.7) * beatWarp * (0.12 + depthNorm * 0.18);
      const pulseY = Math.sin(elapsed * 2.2 + node.seed * 11.4) * beatWarp * (0.12 + depthNorm * 0.18);
      const pulseZ = Math.cos(elapsed * 2.8 + node.seed * 10.1) * beatWarp * (0.16 + depthNorm * 0.24);
      treeX += pulseX;
      treeY += pulseY;
      treeZ += pulseZ;
    }

    const x = treeX * (1 - torusProjection) + torusX * torusProjection;
    const y = treeY * (1 - torusProjection) + torusY * torusProjection;
    const z = treeZ * (1 - torusProjection) + torusZ * torusProjection;

    const hue = modulo(0.03 + depthNorm * 0.58 + bandPhase / TWO_PI + node.seed * 0.1 + extraCount * 0.03, 1);
    const light = clamp(0.24 + bandAmp * 0.62 + frame.beatPulse * 0.2 + depthNorm * 0.08, 0, 1);
    const [r, g, b] = hslToRgb(hue, 0.82, light);
    return { x, y, z, r, g, b };
  }

  getActiveNodeSnapshot() {
    return {
      count: this.activeNodeCount,
      ids: this.activeNodeIds,
      world: this.nodeWorld,
    };
  }

  generatorVector(gen, parentSeed, depth) {
    const base = this.directionMap[gen] || [1, 0, 0];
    let x = base[0];
    let y = base[1];
    let z = base[2];

    const twist = Math.sin(parentSeed * 19.7 + depth * 1.73) * 0.28;
    x += twist * 0.45;
    y += Math.cos(parentSeed * 23.1 + depth * 1.41) * 0.24;
    z += Math.sin(parentSeed * 17.3 + depth * 1.29) * 0.26;

    const length = Math.hypot(x, y, z) || 1;
    return {
      x: x / length,
      y: y / length,
      z: z / length,
    };
  }

  seedFrom(parentSeed, gen, depth) {
    const code = String(gen).charCodeAt(0);
    const raw = Math.sin(parentSeed * 12.9898 + code * 78.233 + depth * 5.937) * 43758.5453;
    return raw - Math.floor(raw);
  }

  computeMaxNodes(depth) {
    const baseCount = this.baseGenerators.length;
    if (baseCount <= 0) {
      return 1;
    }

    if (baseCount === 1) {
      return 1 + 2 * depth;
    }

    const symbols = baseCount * 2;
    const branch = symbols - 1;
    const total = 1 + symbols * ((branch ** depth - 1) / (branch - 1));
    return Math.floor(total);
  }
}

function buildFreeGroupSystem(baseGenerators, vectorDimensions) {
  const bases = sanitizeBaseGenerators(baseGenerators);
  const dims = sanitizeDimensions(vectorDimensions);
  const projectionRows = createProjectionRows(dims);
  const generators = [];
  const inverseMap = {};
  const symbolMeta = {};
  const directionMap = {};

  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i];
    const inverse = inverseSymbol(base);
    generators.push(base, inverse);
    inverseMap[base] = inverse;
    inverseMap[inverse] = base;
    symbolMeta[base] = { baseIndex: i, sign: 1 };
    symbolMeta[inverse] = { baseIndex: i, sign: -1 };

    const baseDirectionND = createBaseDirection(i, bases.length, dims);
    const baseDirection3D = projectVector(baseDirectionND, projectionRows);
    directionMap[base] = baseDirection3D;
    directionMap[inverse] = [-baseDirection3D[0], -baseDirection3D[1], -baseDirection3D[2]];
  }

  return {
    baseGenerators: bases,
    generators,
    inverseMap,
    symbolMeta,
    directionMap,
  };
}

function sanitizeBaseGenerators(baseGenerators) {
  const rawList = Array.isArray(baseGenerators) ? baseGenerators : ['a', 'b'];
  const clean = [];
  const seen = new Set();

  for (const raw of rawList) {
    const symbol = normalizeBaseSymbol(raw);
    if (!symbol) {
      continue;
    }
    const inv = inverseSymbol(symbol);
    if (seen.has(symbol) || seen.has(inv)) {
      continue;
    }
    seen.add(symbol);
    seen.add(inv);
    clean.push(symbol);
  }

  if (clean.length === 0) {
    return ['a', 'b'];
  }
  return clean;
}

function normalizeBaseSymbol(raw) {
  if (raw === undefined || raw === null) {
    return '';
  }

  const symbol = String(raw).trim();
  if (!symbol) {
    return '';
  }

  if (/^[A-Z]$/.test(symbol)) {
    return symbol.toLowerCase();
  }
  if (symbol.endsWith('^-1')) {
    return symbol.slice(0, -3).trim();
  }
  return symbol;
}

function inverseSymbol(symbol) {
  if (/^[a-z]$/.test(symbol)) {
    return symbol.toUpperCase();
  }
  if (/^[A-Z]$/.test(symbol)) {
    return symbol.toLowerCase();
  }
  if (symbol.endsWith('^-1')) {
    return symbol.slice(0, -3);
  }
  return `${symbol}^-1`;
}

function sanitizeDimensions(vectorDimensions) {
  const parsed = Number(vectorDimensions);
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.max(2, Math.floor(parsed));
}

function createBaseDirection(index, totalBases, dims) {
  const direction = new Array(dims).fill(0);

  const azimuth = (TWO_PI * index) / Math.max(totalBases, 3);
  direction[0] = Math.cos(azimuth);
  direction[1] = Math.sin(azimuth);

  for (let d = 2; d < dims; d += 1) {
    const phase = index * (d + 1) * 1.137 + totalBases * 0.193;
    direction[d] = 0.45 * Math.sin(phase) + 0.2 * Math.cos(phase * 0.73);
  }

  if (index === 0) {
    direction[0] += 0.3;
    direction[Math.min(2, dims - 1)] += 0.25;
  } else if (index === 1) {
    direction[1] += 0.3;
    direction[Math.min(2, dims - 1)] -= 0.25;
  } else if (index === 2) {
    direction[Math.min(2, dims - 1)] += 0.35;
  }

  return normalize(direction);
}

function createProjectionRows(dims) {
  const rows = [new Array(dims), new Array(dims), new Array(dims)];
  for (let d = 0; d < dims; d += 1) {
    const t = d + 1;
    rows[0][d] = Math.cos(t * 0.79) + 0.23 * Math.sin(t * 1.21);
    rows[1][d] = Math.sin(t * 1.13) - 0.19 * Math.cos(t * 0.63);
    rows[2][d] = Math.cos(t * 0.47 + 0.2) + 0.27 * Math.sin(t * 1.71);
  }

  return rows.map((row) => normalize(row));
}

function projectVector(vector, projectionRows) {
  const projected = [0, 0, 0];
  for (let row = 0; row < 3; row += 1) {
    let sum = 0;
    for (let i = 0; i < vector.length; i += 1) {
      sum += vector[i] * projectionRows[row][i];
    }
    projected[row] = sum;
  }

  return normalize(projected);
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}
