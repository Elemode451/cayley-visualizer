import * as THREE from 'three';
import ThreeGlobe from 'three-globe';
import { clamp, hslToRgb, modulo, TWO_PI } from './math-utils.js';

const GLOBE_RADIUS = 100;
const GLOBE_SCALE = 0.035;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const BURST_POINT_COUNT = 192;

export class EarthModeView {
  constructor({ scene, bandCount = 48, pointCount = 64 }) {
    this.bandCount = bandCount;
    this.pointCount = pointCount;
    this.points = buildEarthPoints(pointCount, bandCount);
    this.heights = new Float32Array(pointCount);
    this.heightVelocity = new Float32Array(pointCount);
    this.tipWorld = new Float32Array(pointCount * 3);
    this.pointColors = new Array(pointCount);
    this.scoreBuffer = new Array(pointCount);
    this.rings = [];
    this.ringId = 0;
    this.spinSpeed = 1.35;
    this.lastElapsed = 0;
    this.burstCursor = 0;
    this.burstLife = new Float32Array(BURST_POINT_COUNT);
    this.burstPosition = new Float32Array(BURST_POINT_COUNT * 3);
    this.burstVelocity = new Float32Array(BURST_POINT_COUNT * 3);
    this.burstColor = new Float32Array(BURST_POINT_COUNT * 3);

    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0.2);
    this.group.scale.setScalar(GLOBE_SCALE);
    scene.add(this.group);

    this.globe = new ThreeGlobe({ waitForGlobeReady: false, animateIn: false })
      .globeImageUrl('./node_modules/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('./node_modules/three-globe/example/img/earth-topology.png')
      .showAtmosphere(true)
      .atmosphereColor('#89d6ff')
      .atmosphereAltitude(0.18)
      .ringsData(this.rings)
      .ringLat('lat')
      .ringLng('lng')
      .ringAltitude('altitude')
      .ringMaxRadius('maxRadius')
      .ringPropagationSpeed('speed')
      .ringRepeatPeriod('period')
      .ringColor((ring) => (t) => {
        const alpha = Math.max(0, (1 - t) * ring.alpha);
        return `rgba(${ring.color[0]}, ${ring.color[1]}, ${ring.color[2]}, ${alpha.toFixed(3)})`;
      });

    const globeMaterial = this.globe.globeMaterial();
    if (globeMaterial) {
      globeMaterial.color = new THREE.Color(0xffffff);
      globeMaterial.emissive = new THREE.Color(0x050b12);
      globeMaterial.emissiveIntensity = 0.08;
      globeMaterial.shininess = 22;
      globeMaterial.bumpScale = 0.28;
      applyGlobeGrayscale(globeMaterial);
    }

    this.group.add(this.globe);

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = 1024;
    this.overlayCanvas.height = 512;
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.overlayTexture = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTexture.colorSpace = THREE.SRGBColorSpace;
    this.overlayTexture.wrapS = THREE.RepeatWrapping;
    this.overlayTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.overlayTexture.minFilter = THREE.LinearFilter;
    this.overlayTexture.magFilter = THREE.LinearFilter;

    this.overlayMesh = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.008, 72, 48),
      new THREE.MeshBasicMaterial({
        map: this.overlayTexture,
        transparent: true,
        opacity: 0.62,
        blending: THREE.NormalBlending,
        depthWrite: false,
      })
    );
    this.group.add(this.overlayMesh);

    this.sunLight = new THREE.DirectionalLight(0xfff7d0, 1.7);
    this.sunLight.position.set(180, 45, 120);
    this.group.add(this.sunLight);

    this.nightFill = new THREE.DirectionalLight(0x16344d, 0.28);
    this.nightFill.position.set(-120, -24, -140);
    this.group.add(this.nightFill);

    const spikeMaterial = new THREE.MeshStandardMaterial({
      color: 0xa8e8ff,
      emissive: 0x0f3950,
      emissiveIntensity: 0.7,
      roughness: 0.28,
      metalness: 0.16,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
    });

    this.spikeMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.55, 0.14, 1, 10, 1, false),
      spikeMaterial,
      pointCount
    );
    this.spikeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.spikeMesh);

    this.tipMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.88, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0xc9f4ff,
        transparent: true,
        opacity: 0.95,
        vertexColors: true,
      }),
      pointCount
    );
    this.tipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.tipMesh);

    this.maxEdges = pointCount * 5;
    this.edgePositions = new Float32Array(this.maxEdges * 2 * 3);
    this.edgeColors = new Float32Array(this.maxEdges * 2 * 3);
    this.edgeGeometry = new THREE.BufferGeometry();
    this.edgeGeometry.setAttribute('position', new THREE.BufferAttribute(this.edgePositions, 3));
    this.edgeGeometry.setAttribute('color', new THREE.BufferAttribute(this.edgeColors, 3));
    this.edgeGeometry.setDrawRange(0, 0);
    this.edgeLines = new THREE.LineSegments(
      this.edgeGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.group.add(this.edgeLines);

    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.12, 42, 42),
      new THREE.MeshBasicMaterial({
        color: 0x4cc9ff,
        transparent: true,
        opacity: 0.065,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      })
    );
    this.group.add(this.aura);

    this.burstGeometry = new THREE.BufferGeometry();
    this.burstGeometry.setAttribute('position', new THREE.BufferAttribute(this.burstPosition, 3));
    this.burstGeometry.setAttribute('color', new THREE.BufferAttribute(this.burstColor, 3));
    this.burstGeometry.setDrawRange(0, 0);
    this.burstPoints = new THREE.Points(
      this.burstGeometry,
      new THREE.PointsMaterial({
        size: 3.8,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.48,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.group.add(this.burstPoints);

    this.tempMatrix = new THREE.Matrix4();
    this.tempQuat = new THREE.Quaternion();
    this.identityQuat = new THREE.Quaternion();
    this.tempScale = new THREE.Vector3();
    this.tempPos = new THREE.Vector3();
    this.tempTip = new THREE.Vector3();
    this.tempNormal = new THREE.Vector3();
    this.tempTangent = new THREE.Vector3();
    this.tempBitangent = new THREE.Vector3();
    this.connectedIds = new Uint16Array(pointCount);

    this.paintOverlay(0, emptyFrame());
    this.setBlend(0);
    this.pauseGlobe();
  }

  update(elapsed, frame, active = false) {
    if (!active) {
      return;
    }

    this.resumeGlobe();

    const delta = this.lastElapsed > 0 ? clamp(elapsed - this.lastElapsed, 1 / 240, 0.08) : 1 / 60;
    this.lastElapsed = elapsed;
    const globalDrive = clamp(frame.bassEnergy * 1.25 + frame.spectralFlux * 0.95 + frame.beatPulse * 1.1, 0, 2.2);
    const transientDrive = clamp(frame.beatPulse * 1.4 + frame.spectralFlux * 1.6 + frame.bassEnergy * 0.75, 0, 2.6);
    const spinRate = 0.08 + this.spinSpeed * 0.22 + globalDrive * 0.12 + frame.centroidHz / 500000;

    this.group.rotation.y += delta * spinRate;
    this.group.rotation.x = Math.sin(elapsed * 0.14) * 0.08 + frame.bassEnergy * 0.12;
    this.group.rotation.z = Math.cos(elapsed * 0.08) * 0.04;
    this.aura.scale.setScalar(1 + globalDrive * 0.14);
    this.aura.material.opacity = 0.04 + frame.beatPulse * 0.12 + frame.spectralFlux * 0.05;
    this.overlayMesh.rotation.y += delta * (0.06 + transientDrive * 0.12);
    this.overlayMesh.rotation.z = Math.sin(elapsed * 0.05) * 0.08;
    this.overlayMesh.material.opacity = 0.42 + globalDrive * 0.22;
    this.edgeLines.material.opacity = 0.28 + globalDrive * 0.18 + frame.beatPulse * 0.08;

    const solarAngle = elapsed * (0.09 + frame.bassEnergy * 0.05) + frame.centroidHz / 2400;
    this.sunLight.position.set(
      Math.cos(solarAngle) * 185,
      48 + Math.sin(elapsed * 0.2 + frame.spectralFlux * 3) * 26,
      Math.sin(solarAngle) * 185
    );
    this.sunLight.intensity = 1.35 + frame.beatPulse * 0.55 + frame.bassEnergy * 0.25;
    this.nightFill.position.copy(this.sunLight.position).multiplyScalar(-0.72);
    this.nightFill.intensity = 0.2 + frame.spectralFlux * 0.16;

    const globeMaterial = this.globe.globeMaterial();
    if (globeMaterial) {
      globeMaterial.emissiveIntensity = 0.06 + frame.bassEnergy * 0.06;
      globeMaterial.bumpScale = 0.24 + frame.beatPulse * 0.16;
    }
    this.paintOverlay(elapsed, frame);

    let rootId = 0;
    let rootScore = -Infinity;

    for (let index = 0; index < this.pointCount; index += 1) {
      const point = this.points[index];
      const band = frame.bandAmpSmooth[point.bandIndex] || 0;
      const phase = frame.bandPhase[point.bandIndex] || 0;
      const harmonic = 0.5 + 0.5 * Math.sin(elapsed * (0.55 + point.seed * 0.35) + point.seed * TWO_PI);
      const bandLift = Math.pow(clamp(band, 0, 1.6), 0.58);
      const targetHeight =
        4 +
        bandLift * (26 + point.weight * 18) +
        globalDrive * (8 + point.weight * 12) +
        transientDrive * (6 + harmonic * 12) +
        frame.beatPulse * bandLift * 14;

      const currentHeight = this.heights[index];
      const targetDelta = targetHeight - currentHeight;
      const stiffness = targetDelta >= 0 ? 0.34 : 0.14;
      const beatKick = Math.max(0, frame.beatPulse - 0.24) * (0.75 + bandLift * 2.2 + point.weight * 0.8);
      this.heightVelocity[index] = clamp(
        this.heightVelocity[index] * 0.68 + targetDelta * stiffness + beatKick * 0.14,
        -6.5,
        7.5
      );
      this.heights[index] = clamp(currentHeight + this.heightVelocity[index], 3, 86);

      const altitude = this.heights[index] / GLOBE_RADIUS;
      const surface = this.globe.getCoords(point.lat, point.lng, 0.008);
      const tip = this.globe.getCoords(point.lat, point.lng, altitude);

      this.tempPos.set(surface.x, surface.y, surface.z);
      this.tempTip.set(tip.x, tip.y, tip.z);
      this.tempNormal.copy(this.tempTip).normalize();

      const midpoint = this.tempPos.lerp(this.tempTip, 0.5);
      this.tempQuat.setFromUnitVectors(Y_AXIS, this.tempNormal);
      this.tempScale.set(1, Math.max(1.2, this.heights[index]), 1);
      this.tempMatrix.compose(midpoint, this.tempQuat, this.tempScale);
      this.spikeMesh.setMatrixAt(index, this.tempMatrix);

      const hue = modulo(0.52 + point.hueBase * 0.24 + phase / TWO_PI * 0.1 + band * 0.06, 1);
      const [r, g, b] = hslToRgb(hue, 0.88, clamp(0.24 + band * 0.58 + frame.beatPulse * 0.16, 0, 1));
      const color = new THREE.Color(r, g, b);
      this.pointColors[index] = color;
      this.spikeMesh.setColorAt(index, color);

      const tipScale = 1.1 + bandLift * 3.4 + transientDrive * 0.85 + frame.beatPulse * 2.1;
      this.tempScale.setScalar(tipScale);
      this.tempMatrix.compose(this.tempTip, this.identityQuat, this.tempScale);
      this.tipMesh.setMatrixAt(index, this.tempMatrix);
      this.tipMesh.setColorAt(index, color);

      const offset = index * 3;
      this.tipWorld[offset] = this.tempTip.x;
      this.tipWorld[offset + 1] = this.tempTip.y;
      this.tipWorld[offset + 2] = this.tempTip.z;

      const score =
        bandLift * (0.95 + point.weight * 0.85) +
        frame.beatPulse * (0.4 + harmonic * 0.22) +
        globalDrive * 0.3;
      this.scoreBuffer[index] = { id: index, score, color };
      if (score > rootScore) {
        rootScore = score;
        rootId = index;
      }
    }

    this.spikeMesh.instanceMatrix.needsUpdate = true;
    this.tipMesh.instanceMatrix.needsUpdate = true;
    if (this.spikeMesh.instanceColor) {
      this.spikeMesh.instanceColor.needsUpdate = true;
    }
    if (this.tipMesh.instanceColor) {
      this.tipMesh.instanceColor.needsUpdate = true;
    }

    this.scoreBuffer.sort((left, right) => right.score - left.score);
    const activeCount = clamp(Math.floor(10 + globalDrive * 34 + transientDrive * 10), 8, this.pointCount);

    if (frame.beat || frame.beatPulse > 0.72) {
      const ringCount = Math.max(1, Math.min(4, Math.floor(1 + frame.beatPulse * 3 + frame.spectralFlux * 1.5)));
      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const rank = Math.min(
          this.scoreBuffer.length - 1,
          ringIndex * Math.max(1, Math.floor(activeCount / Math.max(1, ringCount)))
        );
        const source = this.scoreBuffer[rank] || this.scoreBuffer[0];
        const ringPoint = this.points[source?.id ?? rootId];
        const ringColor = source?.color || this.scoreBuffer[0]?.color || new THREE.Color(0.7, 0.9, 1);
        this.rings.push({
          id: this.ringId += 1,
          lat: ringPoint.lat,
          lng: ringPoint.lng,
          altitude: 0.02 + frame.beatPulse * 0.016,
          maxRadius: 18 + frame.beatPulse * 24 + frame.spectralFlux * 10,
          speed: 1.8 + frame.bassEnergy * 4.4,
          period: 1400,
          expiresAt: elapsed + 1.9,
          alpha: 0.82 + frame.beatPulse * 0.24,
          color: [
            Math.round(ringColor.r * 255),
            Math.round(ringColor.g * 255),
            Math.round(ringColor.b * 255),
          ],
        });
      }
    }

    this.rings = this.rings.filter((ring) => ring.expiresAt > elapsed);
    this.globe.ringsData(this.rings);

    if (transientDrive > 1.45 || frame.beatPulse > 0.9) {
      const burstCount = Math.max(3, Math.min(14, Math.floor(3 + transientDrive * 3.2 + frame.beatPulse * 4)));
      this.spawnBurstParticles(burstCount, activeCount, transientDrive, frame);
    }

    this.updateBurstParticles(delta, frame);
    this.rebuildEdges(activeCount, globalDrive);
  }

  rebuildEdges(activeCount, globalDrive) {
    if (activeCount <= 1) {
      this.edgeGeometry.setDrawRange(0, 0);
      return;
    }

    let connectedCount = 1;
    this.connectedIds[0] = this.scoreBuffer[0].id;
    let edgeCount = 0;

    for (let i = 1; i < activeCount && edgeCount < this.maxEdges; i += 1) {
      const child = this.scoreBuffer[i];
      const childId = child.id;
      const childOffset = childId * 3;

      let bestParentId = this.connectedIds[0];
      let bestDistance = Infinity;

      for (let j = 0; j < connectedCount; j += 1) {
        const parentId = this.connectedIds[j];
        const parentOffset = parentId * 3;
        const dx = this.tipWorld[childOffset] - this.tipWorld[parentOffset];
        const dy = this.tipWorld[childOffset + 1] - this.tipWorld[parentOffset + 1];
        const dz = this.tipWorld[childOffset + 2] - this.tipWorld[parentOffset + 2];
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestParentId = parentId;
        }
      }

      this.connectedIds[connectedCount] = childId;
      connectedCount += 1;

      const parentColor = this.pointColors[bestParentId] || child.color;
      const edgeOffset = edgeCount * 6;
      const parentOffset = bestParentId * 3;

      this.edgePositions[edgeOffset] = this.tipWorld[parentOffset];
      this.edgePositions[edgeOffset + 1] = this.tipWorld[parentOffset + 1];
      this.edgePositions[edgeOffset + 2] = this.tipWorld[parentOffset + 2];
      this.edgePositions[edgeOffset + 3] = this.tipWorld[childOffset];
      this.edgePositions[edgeOffset + 4] = this.tipWorld[childOffset + 1];
      this.edgePositions[edgeOffset + 5] = this.tipWorld[childOffset + 2];

      this.edgeColors[edgeOffset] = parentColor.r;
      this.edgeColors[edgeOffset + 1] = parentColor.g;
      this.edgeColors[edgeOffset + 2] = parentColor.b;
      this.edgeColors[edgeOffset + 3] = child.color.r;
      this.edgeColors[edgeOffset + 4] = child.color.g;
      this.edgeColors[edgeOffset + 5] = child.color.b;
      edgeCount += 1;
    }

    const longLinkBudget = Math.min(
      this.maxEdges - edgeCount,
      Math.max(0, Math.floor(globalDrive * activeCount * 1.4))
    );

    for (let i = 1; i < activeCount && i <= longLinkBudget && edgeCount < this.maxEdges; i += 1) {
      const child = this.scoreBuffer[i];
      const childId = child.id;
      const childOffset = childId * 3;
      let farParentId = this.connectedIds[0];
      let farDistance = -Infinity;

      for (let j = 0; j < connectedCount; j += 1) {
        const parentId = this.connectedIds[j];
        const parentOffset = parentId * 3;
        const dx = this.tipWorld[childOffset] - this.tipWorld[parentOffset];
        const dy = this.tipWorld[childOffset + 1] - this.tipWorld[parentOffset + 1];
        const dz = this.tipWorld[childOffset + 2] - this.tipWorld[parentOffset + 2];
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance > farDistance) {
          farDistance = distance;
          farParentId = parentId;
        }
      }

      const parentColor = this.pointColors[farParentId] || child.color;
      const edgeOffset = edgeCount * 6;
      const parentOffset = farParentId * 3;

      this.edgePositions[edgeOffset] = this.tipWorld[parentOffset];
      this.edgePositions[edgeOffset + 1] = this.tipWorld[parentOffset + 1];
      this.edgePositions[edgeOffset + 2] = this.tipWorld[parentOffset + 2];
      this.edgePositions[edgeOffset + 3] = this.tipWorld[childOffset];
      this.edgePositions[edgeOffset + 4] = this.tipWorld[childOffset + 1];
      this.edgePositions[edgeOffset + 5] = this.tipWorld[childOffset + 2];

      this.edgeColors[edgeOffset] = parentColor.r;
      this.edgeColors[edgeOffset + 1] = parentColor.g;
      this.edgeColors[edgeOffset + 2] = parentColor.b;
      this.edgeColors[edgeOffset + 3] = child.color.r;
      this.edgeColors[edgeOffset + 4] = child.color.g;
      this.edgeColors[edgeOffset + 5] = child.color.b;
      edgeCount += 1;
    }

    this.edgeGeometry.setDrawRange(0, edgeCount * 2);
    this.edgeGeometry.attributes.position.needsUpdate = true;
    this.edgeGeometry.attributes.color.needsUpdate = true;
  }

  setBlend(alpha) {
    const a = clamp(alpha, 0, 1);
    this.group.visible = a > 0.01;
    this.overlayMesh.material.opacity = (0.42 + this.aura.material.opacity * 1.8) * a;
    this.spikeMesh.material.opacity = 0.06 + a * 0.88;
    this.tipMesh.material.opacity = 0.08 + a * 0.92;
    this.edgeLines.material.opacity = 0.04 + a * 0.62;
    this.aura.material.opacity = 0.02 + a * 0.08;
    this.burstPoints.material.opacity = 0.04 + a * 0.42;
    this.sunLight.visible = a > 0.01;
    this.nightFill.visible = a > 0.01;

    if (a <= 0.01) {
      this.pauseGlobe();
    } else {
      this.resumeGlobe();
    }
  }

  setSpinSpeed(speed) {
    this.spinSpeed = clamp(Number(speed) || 1.35, 0.2, 4);
  }

  spawnBurstParticles(count, activeCount, transientDrive, frame) {
    const sourceCount = Math.min(
      this.scoreBuffer.length,
      Math.max(12, Math.min(this.pointCount, Math.floor(activeCount * 0.95)))
    );
    if (sourceCount <= 0) {
      return;
    }

    for (let burstIndex = 0; burstIndex < count; burstIndex += 1) {
      const spreadRank =
        count <= 1 ? 0 : Math.floor((burstIndex / Math.max(1, count - 1)) * Math.max(1, sourceCount - 1));
      const wrappedOffset = (this.burstCursor * 9 + burstIndex * 7) % sourceCount;
      const source = this.scoreBuffer[(spreadRank + wrappedOffset) % sourceCount];
      if (!source) {
        continue;
      }

      const id = source.id;
      const offset = id * 3;
      const px = this.tipWorld[offset];
      const py = this.tipWorld[offset + 1];
      const pz = this.tipWorld[offset + 2];
      const color = this.pointColors[id] || source.color || new THREE.Color(0.85, 0.93, 1);

      this.tempNormal.set(px, py, pz).normalize();
      this.tempTangent.set(-this.tempNormal.z, 0, this.tempNormal.x);
      if (this.tempTangent.lengthSq() < 1e-5) {
        this.tempTangent.set(1, 0, 0);
      }
      this.tempTangent.normalize();
      this.tempBitangent.crossVectors(this.tempNormal, this.tempTangent).normalize();

      const turn = (this.burstCursor * 0.7548776662466927 + burstIndex * 0.37) % 1;
      const orbitAngle = turn * TWO_PI;
      const sideA = Math.cos(orbitAngle) * (0.22 + frame.beatPulse * 0.35);
      const sideB = Math.sin(orbitAngle) * (0.22 + frame.spectralFlux * 0.32);
      const outward = 0.65 + transientDrive * 0.38 + frame.beatPulse * 0.52;

      const writeIndex = this.burstCursor;
      const writeOffset = writeIndex * 3;
      const launchOffset = 2.2 + frame.beatPulse * 1.6 + transientDrive * 0.9;
      this.burstPosition[writeOffset] = px + this.tempNormal.x * launchOffset;
      this.burstPosition[writeOffset + 1] = py + this.tempNormal.y * launchOffset;
      this.burstPosition[writeOffset + 2] = pz + this.tempNormal.z * launchOffset;
      this.burstVelocity[writeOffset] =
        this.tempNormal.x * outward + this.tempTangent.x * sideA + this.tempBitangent.x * sideB;
      this.burstVelocity[writeOffset + 1] =
        this.tempNormal.y * outward + this.tempTangent.y * sideA + this.tempBitangent.y * sideB;
      this.burstVelocity[writeOffset + 2] =
        this.tempNormal.z * outward + this.tempTangent.z * sideA + this.tempBitangent.z * sideB;
      this.burstColor[writeOffset] = color.r;
      this.burstColor[writeOffset + 1] = color.g;
      this.burstColor[writeOffset + 2] = color.b;
      this.burstLife[writeIndex] = clamp(0.55 + transientDrive * 0.24 + frame.beatPulse * 0.18, 0.45, 1.3);
      this.burstCursor = (this.burstCursor + 1) % BURST_POINT_COUNT;
    }
  }

  updateBurstParticles(delta, frame) {
    for (let index = 0; index < BURST_POINT_COUNT; index += 1) {
      const life = this.burstLife[index];
      const offset = index * 3;
      if (life <= 0.001) {
        this.burstPosition[offset] = 0;
        this.burstPosition[offset + 1] = 0;
        this.burstPosition[offset + 2] = 0;
        this.burstColor[offset] = 0;
        this.burstColor[offset + 1] = 0;
        this.burstColor[offset + 2] = 0;
        continue;
      }

      const nextLife = Math.max(0, life - delta * (1.15 + frame.spectralFlux * 0.8));
      this.burstLife[index] = nextLife;
      this.burstPosition[offset] += this.burstVelocity[offset] * delta * 22;
      this.burstPosition[offset + 1] += this.burstVelocity[offset + 1] * delta * 22;
      this.burstPosition[offset + 2] += this.burstVelocity[offset + 2] * delta * 22;
      this.burstVelocity[offset] *= 0.965;
      this.burstVelocity[offset + 1] *= 0.965;
      this.burstVelocity[offset + 2] *= 0.965;

      const fade = clamp(nextLife, 0, 1);
      this.burstColor[offset] *= 0.988 + fade * 0.008;
      this.burstColor[offset + 1] *= 0.988 + fade * 0.008;
      this.burstColor[offset + 2] *= 0.988 + fade * 0.008;
    }

    this.burstGeometry.setDrawRange(0, BURST_POINT_COUNT);
    this.burstGeometry.attributes.position.needsUpdate = true;
    this.burstGeometry.attributes.color.needsUpdate = true;
    this.burstPoints.material.size = 2.8 + frame.beatPulse * 2.2 + frame.spectralFlux * 1.2;
  }

  pauseGlobe() {
    if (typeof this.globe.pauseAnimation === 'function') {
      this.globe.pauseAnimation();
    }
  }

  resumeGlobe() {
    if (typeof this.globe.resumeAnimation === 'function') {
      this.globe.resumeAnimation();
    }
  }

  paintOverlay(elapsed, frame) {
    if (!this.overlayCtx) {
      return;
    }

    const ctx = this.overlayCtx;
    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, 'rgba(5, 10, 18, 0.9)');
    gradient.addColorStop(0.5, `rgba(10, 18, 28, ${(0.84 - frame.beatPulse * 0.12).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(4, 9, 16, 0.92)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (let band = 0; band < this.bandCount; band += 1) {
      const amp = frame.bandAmpSmooth[band] || 0;
      const phase = frame.bandPhase[band] || 0;
      const depthNorm = band / Math.max(1, this.bandCount - 1);
      const flower = sampleFlowerColor(depthNorm, amp, phase, depthNorm, frame.beatPulse);
      const grayscale = clamp(flower.light + frame.spectralFlux * 0.08, 0, 1);
      const gray = Math.round(grayscale * 255);
      const stripeY = Math.floor((1 - depthNorm) * height);
      const stripeHeight = 7 + amp * 34 + frame.beatPulse * 10;
      const alpha = clamp(0.08 + amp * 0.24 + frame.beatPulse * 0.1, 0.08, 0.4);
      const drift = elapsed * (16 + band * 0.65) + phase * 24;
      const waveA = 12 + amp * 80;
      const waveB = 7 + amp * 44;

      ctx.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const y =
          stripeY +
          Math.sin(x * 0.012 + drift) * waveA +
          Math.cos(x * 0.021 - drift * 0.58) * waveB;
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.lineTo(width, stripeY + stripeHeight);
      ctx.lineTo(0, stripeY + stripeHeight);
      ctx.closePath();
      ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, ${alpha.toFixed(3)})`;
      ctx.fill();
    }

    const shimmerCount = 9;
    for (let i = 0; i < shimmerCount; i += 1) {
      const t = i / Math.max(1, shimmerCount - 1);
      const x = modulo(elapsed * (44 + i * 11) + t * width * 1.7, width);
      const lineWidth = 1 + frame.beatPulse * 2 + i * 0.18;
      const alpha = 0.025 + frame.spectralFlux * 0.05 + i * 0.004;
      const gray = Math.round((0.76 + frame.beatPulse * 0.12) * 255);
      ctx.strokeStyle = `rgba(${gray}, ${gray}, ${gray}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(modulo(x + width * 0.08 + frame.bassEnergy * 40, width), height);
      ctx.stroke();
    }

    this.overlayTexture.needsUpdate = true;
  }
}

function buildEarthPoints(pointCount, bandCount) {
  const points = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < pointCount; index += 1) {
    const y = 1 - ((index + 0.5) / pointCount) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    const lat = (Math.asin(y) * 180) / Math.PI;
    const lng = (Math.atan2(z, x) * 180) / Math.PI;

    points.push({
      lat,
      lng,
      bandIndex: Math.floor((index / Math.max(1, pointCount - 1)) * Math.max(0, bandCount - 1)),
      seed: index / Math.max(1, pointCount - 1),
      weight: 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(index * 1.71)),
      hueBase: index / Math.max(1, pointCount),
    });
  }

  return points;
}

function sampleFlowerColor(depthNorm, bandAmp, bandPhase, seed, beatPulse) {
  const hue = modulo(0.03 + depthNorm * 0.58 + bandPhase / TWO_PI + seed * 0.1, 1);
  const light = clamp(0.24 + bandAmp * 0.62 + beatPulse * 0.2 + depthNorm * 0.08, 0, 1);
  return { hue, light };
}

function emptyFrame() {
  return {
    beatPulse: 0,
    spectralFlux: 0,
    bassEnergy: 0,
    bandAmpSmooth: [],
    bandPhase: [],
  };
}

function applyGlobeGrayscale(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      float grayscale = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grayscale), 1.0);
      diffuseColor.rgb *= 1.08;
      `
    );
  };
  material.needsUpdate = true;
}
