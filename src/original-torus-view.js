import * as THREE from 'three';
import { clamp, hslToRgb, modulo, TWO_PI, wrapAngle } from './math-utils.js';

export class OriginalTorusView {
  constructor({ scene, gridU, gridV, majorRadius, tubeRadius, particleCount }) {
    this.gridU = gridU;
    this.gridV = gridV;
    this.majorRadius = majorRadius;
    this.tubeRadius = tubeRadius;
    this.particleCount = particleCount;

    this.ampGrid = new Float32Array(gridU * gridV);
    this.phaseGrid = new Float32Array(gridU * gridV);
    this.ampGridTemp = new Float32Array(gridU * gridV);
    this.cursorU = 0;
    this.freqShift = 0;
    this.mirrorSign = 1;
    this.phaseRotor = 0;

    this.rootGroup = new THREE.Group();
    scene.add(this.rootGroup);

    this.vertexCount = gridU * gridV;
    this.torusPositions = new Float32Array(this.vertexCount * 3);
    this.torusColors = new Float32Array(this.vertexCount * 3);
    const torusIndices = [];

    for (let u = 0; u < gridU; u += 1) {
      for (let v = 0; v < gridV; v += 1) {
        const a = this.gridIndex(u, v);
        const b = this.gridIndex((u + 1) % gridU, v);
        const c = this.gridIndex((u + 1) % gridU, (v + 1) % gridV);
        const d = this.gridIndex(u, (v + 1) % gridV);
        torusIndices.push(a, b, d, b, c, d);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.torusPositions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.torusColors, 3));
    this.geometry.setIndex(torusIndices);
    this.geometry.computeVertexNormals();

    this.meshMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.27,
      metalness: 0.2,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.2,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.meshMaterial);
    this.rootGroup.add(this.mesh);

    this.edgeMesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: 0xbde5ef,
        wireframe: true,
        transparent: true,
        opacity: 0.14,
      })
    );
    this.rootGroup.add(this.edgeMesh);

    this.nodeCloud = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({
        size: 0.075,
        transparent: true,
        opacity: 0.4,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.rootGroup.add(this.nodeCloud);

    this.particlePositions = new Float32Array(particleCount * 3);
    this.particleColors = new Float32Array(particleCount * 3);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    this.particles = [];
    for (let i = 0; i < particleCount; i += 1) {
      this.particles.push({
        u: Math.floor(Math.random() * gridU),
        v: Math.floor(Math.random() * gridV),
        phase: Math.random() * TWO_PI,
        speed: 0.45 + Math.random() * 0.85,
      });
    }

    this.particlePoints = new THREE.Points(
      this.particleGeometry,
      new THREE.PointsMaterial({
        size: 0.11,
        transparent: true,
        opacity: 0.4,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    scene.add(this.particlePoints);
  }

  ingestFrame(frame) {
    if (frame.beat) {
      this.freqShift = (this.freqShift + 1 + (Math.random() < 0.25 ? 1 : 0)) % this.gridV;
      if (Math.random() < 0.16) {
        this.mirrorSign *= -1;
      }
    }

    this.cursorU = (this.cursorU + 1) % this.gridU;
    this.phaseRotor += frame.bassEnergy * 0.22 + (frame.beat ? 0.3 : 0.01);

    for (let v = 0; v < this.gridV; v += 1) {
      const mappedV = (v + this.freqShift) % this.gridV;
      const idx = this.gridIndex(this.cursorU, mappedV);
      this.ampGrid[idx] = frame.bandAmpSmooth[v];
      this.phaseGrid[idx] = wrapAngle(frame.bandPhase[v] + this.phaseRotor);
    }
  }

  diffuse(diffusion, bassEnergy) {
    const phaseDrift = 0.006 + bassEnergy * 0.05;
    for (let u = 0; u < this.gridU; u += 1) {
      for (let v = 0; v < this.gridV; v += 1) {
        const idx = this.gridIndex(u, v);
        const up = this.ampGrid[this.gridIndex((u + 1) % this.gridU, v)];
        const down = this.ampGrid[this.gridIndex((u - 1 + this.gridU) % this.gridU, v)];
        const right = this.ampGrid[this.gridIndex(u, (v + 1) % this.gridV)];
        const left = this.ampGrid[this.gridIndex(u, (v - 1 + this.gridV) % this.gridV)];
        const neighborAverage = (up + down + right + left) * 0.25;
        const current = this.ampGrid[idx] * 0.995;
        this.ampGridTemp[idx] = current * (1 - diffusion) + neighborAverage * diffusion;
        this.phaseGrid[idx] = wrapAngle(this.phaseGrid[idx] + phaseDrift + neighborAverage * 0.04);
      }
    }
    this.ampGrid.set(this.ampGridTemp);
  }

  update(elapsed, { heightScale, centroidHz, bassEnergy, beatPulse }) {
    const drift = 0.0015 + beatPulse * 0.005;
    this.rootGroup.rotation.z += drift;
    this.rootGroup.rotation.x = 0.25 + Math.sin(elapsed * 0.19) * 0.1 + (centroidHz / 6000) * 0.2;
    this.rootGroup.rotation.y = Math.sin(elapsed * 0.13) * 0.14 * this.mirrorSign;

    const centroidNorm = clamp(centroidHz / 5000, 0, 1);
    const twist = 0.17 + bassEnergy * 0.95 + beatPulse * 0.45;

    for (let u = 0; u < this.gridU; u += 1) {
      const sampleU = (this.cursorU - u + this.gridU) % this.gridU;
      const uAngle = (u / this.gridU) * TWO_PI;
      const cosU = Math.cos(uAngle);
      const sinU = Math.sin(uAngle);

      for (let v = 0; v < this.gridV; v += 1) {
        const idxData = this.gridIndex(sampleU, v);
        const idxVertex = this.gridIndex(u, v);

        const amp = this.ampGrid[idxData];
        const phase = this.phaseGrid[idxData];
        const vAngle = (v / this.gridV) * TWO_PI;
        const warpedV = vAngle + Math.sin(uAngle * 2 + elapsed * 0.8 + vAngle * 0.5) * twist * 0.12;
        const cosV = Math.cos(warpedV);
        const sinV = Math.sin(warpedV);

        const radial = this.tubeRadius + amp * heightScale * 1.75;
        const x = (this.majorRadius + radial * cosV) * cosU * this.mirrorSign;
        const y = (this.majorRadius + radial * cosV) * sinU;
        const z = radial * sinV;

        const offset = idxVertex * 3;
        this.torusPositions[offset] = x;
        this.torusPositions[offset + 1] = y;
        this.torusPositions[offset + 2] = z;

        const hue = modulo(phase / TWO_PI + 0.55 + centroidNorm * 0.25, 1);
        const sat = clamp(0.66 + amp * 0.25, 0, 1);
        const light = clamp(0.18 + amp * 0.72 + beatPulse * 0.14, 0, 1);
        const [r, g, b] = hslToRgb(hue, sat, light);
        this.torusColors[offset] = r;
        this.torusColors[offset + 1] = g;
        this.torusColors[offset + 2] = b;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.updateParticles(elapsed, centroidNorm, beatPulse);
  }

  updateParticles(elapsed, centroidNorm, beatPulse) {
    for (let i = 0; i < this.particleCount; i += 1) {
      const p = this.particles[i];
      const localAmp = this.ampGrid[this.gridIndex(p.u, p.v)];

      if (Math.random() < 0.1 + localAmp * 0.5 + beatPulse * 0.1) {
        const r = Math.random();
        if (r < 0.25) p.u = (p.u + 1) % this.gridU;
        else if (r < 0.5) p.u = (p.u - 1 + this.gridU) % this.gridU;
        else if (r < 0.75) p.v = (p.v + 1) % this.gridV;
        else p.v = (p.v - 1 + this.gridV) % this.gridV;

        if (beatPulse > 0.3 && Math.random() < 0.18) {
          p.u = (p.u + 1) % this.gridU;
          p.v = (p.v + 1) % this.gridV;
        }
      }

      p.phase += p.speed * (0.024 + localAmp * 0.12);
      const uAngle = (p.u / this.gridU) * TWO_PI;
      const vAngle = (p.v / this.gridV) * TWO_PI + Math.sin(elapsed + p.phase) * 0.08;
      const radial = this.tubeRadius + localAmp * 1.95 + 0.17 * Math.sin(p.phase);

      const x = (this.majorRadius + radial * Math.cos(vAngle)) * Math.cos(uAngle) * this.mirrorSign;
      const y = (this.majorRadius + radial * Math.cos(vAngle)) * Math.sin(uAngle);
      const z = radial * Math.sin(vAngle);

      const offset = i * 3;
      this.particlePositions[offset] = x;
      this.particlePositions[offset + 1] = y;
      this.particlePositions[offset + 2] = z;

      const hue = modulo(0.07 + centroidNorm * 0.45 + p.phase * 0.01, 1);
      const [r, g, b] = hslToRgb(hue, 0.82, clamp(0.42 + localAmp * 0.72, 0, 1));
      this.particleColors[offset] = r;
      this.particleColors[offset + 1] = g;
      this.particleColors[offset + 2] = b;
    }

    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
  }

  setBlend(alpha) {
    const clamped = clamp(alpha, 0, 1);
    this.meshMaterial.opacity = clamped;
    this.edgeMesh.material.opacity = 0.06 + clamped * 0.22;
    this.nodeCloud.material.opacity = 0.16 + clamped * 0.64;
    this.particlePoints.material.opacity = 0.18 + clamped * 0.74;
    this.rootGroup.visible = clamped > 0.01;
    this.particlePoints.visible = clamped > 0.01;
  }

  gridIndex(u, v) {
    return u * this.gridV + v;
  }
}
