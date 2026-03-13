import * as THREE from 'three';
import { buildLogBands, createFFTPlan, fftInPlace } from './fft-utils.js';
import { clamp, hslToRgb, modulo, TWO_PI } from './math-utils.js';

export class FourierImageView {
  constructor({ scene, bands = 48, columns = 512, width = 8, height = 4.8 }) {
    this.bands = bands;
    this.columns = columns;
    this.width = width;
    this.height = height;

    this.cursor = 0;
    this.waves = [];
    this.hasStaticImage = false;

    this.energyMap = new Float32Array(columns * bands);
    this.phaseMap = new Float32Array(columns * bands);

    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = columns;
    this.baseCanvas.height = bands;
    this.baseCtx = this.baseCanvas.getContext('2d');
    this.baseCtx.fillStyle = 'rgba(3, 6, 10, 1)';
    this.baseCtx.fillRect(0, 0, columns, bands);

    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = columns;
    this.compositeCanvas.height = bands;
    this.compositeCtx = this.compositeCanvas.getContext('2d');
    this.compositeCtx.fillStyle = 'rgba(3, 6, 10, 1)';
    this.compositeCtx.fillRect(0, 0, columns, bands);

    this.texture = new THREE.CanvasTexture(this.compositeCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.group = new THREE.Group();
    this.group.position.set(0, 0, 1.2);
    scene.add(this.group);

    this.surfaceX = Math.min(240, Math.max(96, Math.floor(columns * 0.42)));
    this.surfaceY = Math.min(132, Math.max(52, Math.floor(bands * 1.9)));
    this.surfaceGeometry = new THREE.PlaneGeometry(width, height, this.surfaceX - 1, this.surfaceY - 1);
    this.surfacePositions = this.surfaceGeometry.attributes.position.array;
    this.surfaceBase = new Float32Array(this.surfacePositions.length);
    this.surfaceBase.set(this.surfacePositions);

    this.surfaceMesh = new THREE.Mesh(
      this.surfaceGeometry,
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      })
    );
    this.group.add(this.surfaceMesh);

    this.glowMesh = new THREE.Mesh(
      this.surfaceGeometry,
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.glowMesh.scale.setScalar(1.01);
    this.group.add(this.glowMesh);

    this.wireMesh = new THREE.Mesh(
      this.surfaceGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x8fd8ff,
        wireframe: true,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      })
    );
    this.group.add(this.wireMesh);

    this.rings = [];
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(width * (0.35 + i * 0.12), 0.016 + i * 0.002, 10, 128),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0x78d8ff : i === 1 ? 0x88ffc8 : 0xffb98c,
          transparent: true,
          opacity: 0.22 - i * 0.04,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.z = -0.14 + i * 0.08;
      this.group.add(ring);
      this.rings.push(ring);
    }

    this.particleCount = 1100;
    this.particleState = new Array(this.particleCount);
    this.particlePos = new Float32Array(this.particleCount * 3);
    this.particleColor = new Float32Array(this.particleCount * 3);
    this.particleGeometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.particlePos, 3);
    const colAttr = new THREE.BufferAttribute(this.particleColor, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    this.particleGeometry.setAttribute('position', posAttr);
    this.particleGeometry.setAttribute('color', colAttr);

    this.particlePoints = new THREE.Points(
      this.particleGeometry,
      new THREE.PointsMaterial({
        size: 0.055,
        vertexColors: true,
        transparent: true,
        opacity: 0.68,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.group.add(this.particlePoints);

    for (let i = 0; i < this.particleCount; i += 1) {
      this.particleState[i] = {
        u: Math.random() * (this.columns - 1),
        v: Math.random() * (this.bands - 1),
        speed: 0.3 + Math.random() * 1.15,
        seed: Math.random() * TWO_PI,
      };
    }

    this.lastElapsed = 0;
    this.setBlend(0);
  }

  update(elapsed, frame, active = false) {
    if (!active) {
      return;
    }

    const dt = clamp(elapsed - this.lastElapsed, 0.001, 0.05);
    this.lastElapsed = elapsed;

    if (!this.hasStaticImage) {
      this.ingestFrame(frame);
    }

    if (frame.beat || frame.beatPulse > 0.31) {
      this.spawnWave(frame);
    }

    this.advanceWaves(frame);
    this.compose(elapsed, frame);
    this.updateSurface(elapsed, frame, dt);
    this.updateParticles(elapsed, frame, dt);
    this.updateRigMotion(elapsed, frame);
  }

  async loadSongImageFromFile(file, audioContext) {
    if (!file || !audioContext) {
      this.hasStaticImage = false;
      return;
    }

    const fftSize = 1024;
    const hopSize = 512;
    const plan = createFFTPlan(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i += 1) {
      window[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / (fftSize - 1)));
    }

    const arrayBuffer = await file.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channels = decoded.numberOfChannels;
    const channelData = [];
    for (let c = 0; c < channels; c += 1) {
      channelData.push(decoded.getChannelData(c));
    }

    const maxFrames = Math.max(1, Math.floor((decoded.length - fftSize) / hopSize));
    const frameStep = maxFrames > this.columns ? maxFrames / this.columns : 1;
    const bands = buildLogBands(decoded.sampleRate, fftSize, this.bands);

    this.baseCtx.fillStyle = 'rgba(3, 6, 10, 1)';
    this.baseCtx.fillRect(0, 0, this.columns, this.bands);
    this.energyMap.fill(0);
    this.phaseMap.fill(0);

    for (let col = 0; col < this.columns; col += 1) {
      const frameIndex = Math.min(maxFrames - 1, Math.floor(col * frameStep));
      const start = frameIndex * hopSize;

      for (let i = 0; i < fftSize; i += 1) {
        let sample = 0;
        const idx = start + i;
        if (idx < decoded.length) {
          for (let c = 0; c < channels; c += 1) {
            sample += channelData[c][idx] || 0;
          }
          sample /= channels;
        }
        re[i] = sample * window[i];
        im[i] = 0;
      }

      fftInPlace(re, im, plan);

      for (let b = 0; b < this.bands; b += 1) {
        const startBin = bands.starts[b];
        const endBin = bands.ends[b];
        let mag = 0;
        let phaseRe = 0;
        let phaseIm = 0;
        for (let k = startBin; k < endBin; k += 1) {
          const rv = re[k];
          const iv = im[k];
          mag += Math.hypot(rv, iv);
          phaseRe += rv;
          phaseIm += iv;
        }

        const binCount = Math.max(1, endBin - startBin);
        const amp = Math.log1p(8 * (mag / binCount)) / Math.log1p(8);
        const phase = Math.atan2(phaseIm, phaseRe);
        this.energyMap[this.dataIndex(col, b)] = amp;
        this.phaseMap[this.dataIndex(col, b)] = phase;

        const [r, g, bl] = this.colorFromSample(amp, phase, b);
        const y = this.bands - 1 - b;
        this.baseCtx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(bl * 255)})`;
        this.baseCtx.fillRect(col, y, 1, 1);
      }
    }

    this.cursor = 0;
    this.hasStaticImage = true;
    this.compose(0, { beatPulse: 0, bassEnergy: 0, spectralFlux: 0, centroidHz: 0 });
  }

  clearStaticImage() {
    this.hasStaticImage = false;
    this.cursor = 0;
    this.waves.length = 0;
  }

  setBlend(alpha) {
    const a = clamp(alpha, 0, 1);
    this.surfaceMesh.material.opacity = 0.12 + a * 0.88;
    this.glowMesh.material.opacity = 0.08 + a * 0.5;
    this.wireMesh.material.opacity = 0.02 + a * 0.2;
    this.particlePoints.material.opacity = 0.08 + a * 0.76;
    for (let i = 0; i < this.rings.length; i += 1) {
      this.rings[i].material.opacity = (0.08 + a * 0.22) * (1 - i * 0.16);
    }
    this.group.visible = a > 0.01;
  }

  ingestFrame(frame) {
    const x = this.cursor;
    this.baseCtx.fillStyle = 'rgba(3, 6, 10, 1)';
    this.baseCtx.fillRect(x, 0, 1, this.bands);

    const maxBand = Math.min(this.bands, frame.bandAmpSmooth.length);
    for (let b = 0; b < maxBand; b += 1) {
      const amp = frame.bandAmpSmooth[b];
      const phase = frame.bandPhase[b] || 0;

      this.energyMap[this.dataIndex(x, b)] = amp;
      this.phaseMap[this.dataIndex(x, b)] = phase;

      const [r, g, bl] = this.colorFromSample(amp, phase, b);
      const y = this.bands - 1 - b;
      this.baseCtx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(bl * 255)})`;
      this.baseCtx.fillRect(x, y, 1, 1);
    }

    this.cursor = (this.cursor + 1) % this.columns;
  }

  colorFromSample(amp, phase, band) {
    const bandNorm = band / Math.max(1, this.bands - 1);
    const hue = modulo(0.62 - bandNorm * 0.48 + phase / TWO_PI * 0.2 + amp * 0.07, 1);
    const sat = clamp(0.58 + amp * 0.34, 0, 1);
    const light = clamp(0.05 + amp ** 0.75 * 0.9, 0, 1);
    return hslToRgb(hue, sat, light);
  }

  spawnWave(frame) {
    const x = this.cursor;
    const centroidNorm = clamp((frame.centroidHz || 0) / 4500, 0, 1);
    const y = this.bands * (0.12 + centroidNorm * 0.78);
    this.waves.push({
      x,
      y,
      radius: 2 + frame.beatPulse * 6,
      alpha: clamp(0.32 + frame.beatPulse * 0.58, 0.22, 0.96),
      speed: 0.9 + frame.bassEnergy * 3.9 + frame.spectralFlux * 2.2,
      width: 2.4 + frame.bassEnergy * 5.2,
      hueShift: Math.random(),
    });

    if (this.waves.length > 20) {
      this.waves.shift();
    }
  }

  advanceWaves(frame) {
    const decay = clamp(0.955 - frame.spectralFlux * 0.028, 0.88, 0.97);
    for (let i = this.waves.length - 1; i >= 0; i -= 1) {
      const wave = this.waves[i];
      wave.radius += wave.speed;
      wave.alpha *= decay;
      if (wave.alpha < 0.03) {
        this.waves.splice(i, 1);
      }
    }
  }

  compose(elapsed, frame) {
    this.compositeCtx.drawImage(this.baseCanvas, 0, 0);

    const shimmer = 0.08 + frame.spectralFlux * 0.2;
    this.compositeCtx.fillStyle = `rgba(255, 255, 255, ${shimmer.toFixed(3)})`;
    const shineX = Math.floor(((Math.sin(elapsed * 0.32) * 0.5 + 0.5) * this.columns) % this.columns);
    this.compositeCtx.fillRect(shineX, 0, 1, this.bands);

    this.compositeCtx.lineWidth = 1.1 + frame.beatPulse * 2.7;
    for (const wave of this.waves) {
      const hue = modulo(0.05 + wave.hueShift * 0.18 + wave.radius * 0.0038 + elapsed * 0.03, 1);
      const [r, g, b] = hslToRgb(hue, 0.92, 0.72);
      this.compositeCtx.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
        b * 255
      )}, ${wave.alpha.toFixed(3)})`;
      this.compositeCtx.beginPath();
      this.compositeCtx.arc(wave.x, wave.y, wave.radius, 0, TWO_PI);
      this.compositeCtx.stroke();

      if (wave.x - wave.radius < 0) {
        this.compositeCtx.beginPath();
        this.compositeCtx.arc(wave.x + this.columns, wave.y, wave.radius, 0, TWO_PI);
        this.compositeCtx.stroke();
      } else if (wave.x + wave.radius > this.columns) {
        this.compositeCtx.beginPath();
        this.compositeCtx.arc(wave.x - this.columns, wave.y, wave.radius, 0, TWO_PI);
        this.compositeCtx.stroke();
      }
    }

    this.texture.needsUpdate = true;
  }

  updateSurface(elapsed, frame, dt) {
    const pos = this.surfacePositions;
    const zStrength = 0.65 + frame.bassEnergy * 1.5 + frame.beatPulse * 0.75;
    const rippleStrength = 0.36 + frame.spectralFlux * 0.8;

    let ptr = 0;
    for (let iy = 0; iy < this.surfaceY; iy += 1) {
      const vNorm = iy / Math.max(1, this.surfaceY - 1);
      const band = vNorm * (this.bands - 1);

      for (let ix = 0; ix < this.surfaceX; ix += 1) {
        const uNorm = ix / Math.max(1, this.surfaceX - 1);
        const visualCol = uNorm * (this.columns - 1);
        const col = this.mapVisualColumnToData(visualCol);

        const amp = this.sampleMap(this.energyMap, col, band);
        const wave = this.waveFieldAt(col, band);
        const bend = Math.sin((uNorm - 0.5) * Math.PI) * (0.07 + frame.beatPulse * 0.22);
        const micro = Math.sin(elapsed * 0.9 + uNorm * 7.2 + band * 0.13) * (0.02 + amp * 0.03);

        const z = (amp * 0.68 + wave * rippleStrength) * zStrength + micro;
        pos[ptr] = this.surfaceBase[ptr];
        pos[ptr + 1] = this.surfaceBase[ptr + 1] + bend + wave * 0.045;
        pos[ptr + 2] = this.surfaceBase[ptr + 2] + z;
        ptr += 3;
      }
    }

    this.surfaceGeometry.attributes.position.needsUpdate = true;
    this.surfaceMesh.rotation.z = Math.sin(elapsed * 0.21) * 0.08;
    this.glowMesh.rotation.z = this.surfaceMesh.rotation.z * -0.55;
    this.wireMesh.rotation.z = this.surfaceMesh.rotation.z;
    this.surfaceMesh.position.z = 0.02 * Math.sin(elapsed * 0.6) + frame.beatPulse * 0.13;
    this.glowMesh.position.z = this.surfaceMesh.position.z + 0.03;
    this.wireMesh.position.z = this.surfaceMesh.position.z + 0.01;

    for (let i = 0; i < this.rings.length; i += 1) {
      const ring = this.rings[i];
      ring.rotation.z += dt * (0.08 + i * 0.06 + frame.spectralFlux * 0.2);
      ring.rotation.y = Math.sin(elapsed * (0.24 + i * 0.08)) * (0.16 + frame.beatPulse * 0.3);
      ring.scale.setScalar(1 + frame.bassEnergy * 0.1 + i * 0.02);
    }
  }

  updateParticles(elapsed, frame, dt) {
    for (let i = 0; i < this.particleCount; i += 1) {
      const p = this.particleState[i];
      const amp = this.sampleMap(this.energyMap, p.u, p.v);
      const phase = this.sampleMap(this.phaseMap, p.u, p.v);
      const wave = this.waveFieldAt(p.u, p.v);

      p.u = modulo(
        p.u + (0.45 + amp * 2.2 + wave * 0.8) * p.speed * dt * 48 + Math.cos(p.seed + elapsed * 0.6) * 0.02,
        this.columns
      );
      p.v = clamp(
        p.v + Math.sin(p.seed * 2 + elapsed * 0.9 + p.u * 0.015) * (0.08 + amp * 0.22) + wave * 0.08,
        0,
        this.bands - 1
      );

      const uNorm = p.u / Math.max(1, this.columns - 1);
      const vNorm = p.v / Math.max(1, this.bands - 1);
      const x = (uNorm - 0.5) * this.width;
      const y = (vNorm - 0.5) * this.height;
      const z = (amp * 0.58 + wave * 0.4) * (0.8 + frame.bassEnergy * 0.9) + 0.02;

      const offset = i * 3;
      this.particlePos[offset] = x;
      this.particlePos[offset + 1] = y;
      this.particlePos[offset + 2] = z;

      const hue = modulo(0.52 + phase / TWO_PI * 0.15 + amp * 0.1, 1);
      const [r, g, b] = hslToRgb(hue, 0.78, clamp(0.24 + amp * 0.7 + wave * 0.22, 0, 1));
      this.particleColor[offset] = r;
      this.particleColor[offset + 1] = g;
      this.particleColor[offset + 2] = b;
    }

    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
  }

  updateRigMotion(elapsed, frame) {
    this.group.rotation.x = 0.24 + Math.sin(elapsed * 0.18) * 0.1 + frame.bassEnergy * 0.18;
    this.group.rotation.y = Math.sin(elapsed * 0.14) * 0.18;
    this.group.rotation.z += 0.0011 + frame.beatPulse * 0.0028;
    this.group.position.z = 1.1 + frame.bassEnergy * 0.25;
  }

  dataIndex(col, band) {
    return col * this.bands + band;
  }

  mapVisualColumnToData(visualColumn) {
    if (this.hasStaticImage) {
      return visualColumn;
    }
    return modulo(visualColumn + this.cursor, this.columns);
  }

  sampleMap(buffer, col, band) {
    const c0 = Math.floor(col);
    const c1 = modulo(c0 + 1, this.columns);
    const t = col - c0;

    const b0 = clamp(Math.floor(band), 0, this.bands - 1);
    const b1 = clamp(b0 + 1, 0, this.bands - 1);
    const u = band - b0;

    const p00 = buffer[this.dataIndex(modulo(c0, this.columns), b0)];
    const p10 = buffer[this.dataIndex(c1, b0)];
    const p01 = buffer[this.dataIndex(modulo(c0, this.columns), b1)];
    const p11 = buffer[this.dataIndex(c1, b1)];

    const a = p00 * (1 - t) + p10 * t;
    const b = p01 * (1 - t) + p11 * t;
    return a * (1 - u) + b * u;
  }

  waveFieldAt(col, band) {
    if (this.waves.length === 0) {
      return 0;
    }

    let value = 0;
    for (const wave of this.waves) {
      let dx = Math.abs(col - wave.x);
      dx = Math.min(dx, this.columns - dx);
      const dy = band - wave.y;
      const dist = Math.hypot(dx, dy);
      const diff = dist - wave.radius;
      const gauss = Math.exp(-(diff * diff) / (2 * wave.width * wave.width));
      value += gauss * wave.alpha;
    }

    return clamp(value, 0, 1.7);
  }
}
