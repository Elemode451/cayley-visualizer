import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AudioEngine } from './src/audio-engine.js';
import { FreeGroupFlowerView } from './src/free-group-flower-view.js';
import { clamp, smoothstep, TWO_PI } from './src/math-utils.js';
import { OriginalTorusView } from './src/original-torus-view.js';

const GRID_U = 120;
const GRID_V = 48;
const FFT_SIZE = 2048;
const CHARACTER_COUNT = 72;
const PARTICLE_COUNT = 260;
const MAJOR_RADIUS = 4.5;
const TUBE_RADIUS = 1.35;

const bgCanvas = document.getElementById('bgWave');
const viewCanvas = document.getElementById('view');
const flatCanvas = document.getElementById('flatView');
const micBtn = document.getElementById('micBtn');
const audioFileInput = document.getElementById('audioFile');
const playPauseBtn = document.getElementById('playPauseBtn');
const restartBtn = document.getElementById('restartBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const gainSlider = document.getElementById('gainSlider');
const diffusionSlider = document.getElementById('diffusionSlider');
const heightSlider = document.getElementById('heightSlider');
const morphSlider = document.getElementById('morphSlider');
const bgWaveOpacitySlider = document.getElementById('bgWaveOpacitySlider');
const torusToggleBtn = document.getElementById('torusToggleBtn');
const torusToggleState = document.getElementById('torusToggleState');
const statusEl = document.getElementById('status');
const centroidStat = document.getElementById('centroidStat');
const fluxStat = document.getElementById('fluxStat');
const bassStat = document.getElementById('bassStat');
const beatStat = document.getElementById('beatStat');
const symmetryStat = document.getElementById('symmetryStat');
const modeStat = document.getElementById('modeStat');
const modeNarrative = document.getElementById('modeNarrative');
const audioPlayer = document.getElementById('audioPlayer');

const bgCtx = bgCanvas.getContext('2d');
const flatCtx = flatCanvas.getContext('2d');

const uiState = {
  excitement: 0,
  morph: 0,
  modeLabel: '2D Characters',
  useFreeTorus: false,
};

const audio = new AudioEngine({
  audioElement: audioPlayer,
  fftSize: FFT_SIZE,
  bandCount: GRID_V,
  characterCount: CHARACTER_COUNT,
  twoPi: TWO_PI,
});

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x071a1d, 8, 22);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, -10, 5);

const renderer = new THREE.WebGLRenderer({
  canvas: viewCanvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 6;
controls.maxDistance = 16;
controls.maxPolarAngle = Math.PI * 0.84;

scene.add(new THREE.AmbientLight(0xb8d8ff, 0.5));
const keyLight = new THREE.DirectionalLight(0xffdcb3, 1.05);
keyLight.position.set(5, -7, 8);
scene.add(keyLight);
const fillLight = new THREE.PointLight(0x7cd9f2, 0.7, 30);
fillLight.position.set(-6, 3, 2);
scene.add(fillLight);

const originalTorus = new OriginalTorusView({
  scene,
  gridU: GRID_U,
  gridV: GRID_V,
  majorRadius: MAJOR_RADIUS,
  tubeRadius: TUBE_RADIUS,
  particleCount: PARTICLE_COUNT,
});

const freeFlowerTorus = new FreeGroupFlowerView({
  scene,
  majorRadius: MAJOR_RADIUS,
  tubeRadius: TUBE_RADIUS,
  maxDepth: 8,
});

setCanvasSize();
window.addEventListener('resize', setCanvasSize);
updateTorusToggleUI();
updateBlendState();
updateStats(audio.getFrame());

micBtn.addEventListener('click', async () => {
  const result = await audio.startMic(Number(gainSlider.value));
  if (result.ok) {
    playPauseBtn.disabled = true;
    restartBtn.disabled = true;
  }
  setStatus(result.message);
});

audioFileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const result = await audio.loadFile(file, Number(gainSlider.value));
  if (result.ok) {
    playPauseBtn.disabled = false;
    restartBtn.disabled = false;
  }
  setStatus(result.message);
});

playPauseBtn.addEventListener('click', async () => {
  const result = await audio.togglePlayPause(Number(gainSlider.value));
  setStatus(result.message);
});

restartBtn.addEventListener('click', async () => {
  const result = await audio.restart(Number(gainSlider.value));
  setStatus(result.message);
});

gainSlider.addEventListener('input', () => {
  audio.setGain(Number(gainSlider.value));
});

function toggleTorusMode() {
  uiState.useFreeTorus = !uiState.useFreeTorus;
  if (uiState.useFreeTorus) {
    // Make the switch visually obvious immediately.
    uiState.excitement = Math.max(uiState.excitement, Number(morphSlider.value) + 0.35);
    uiState.morph = Math.max(uiState.morph, 0.9);
    setStatus('3D mode: Free-Group Flower');
  } else {
    setStatus('3D mode: Original Torus');
  }
  updateTorusToggleUI();
}

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('#torusToggleBtn');
  if (!button || button !== torusToggleBtn) {
    return;
  }
  event.preventDefault();
  toggleTorusMode();
});

fullscreenBtn.addEventListener('click', async () => {
  await toggleFullscreen();
});

document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenBtn.textContent = active ? 'Exit Fullscreen' : 'Fullscreen';
  setCanvasSize();
});

document.addEventListener('keydown', async (event) => {
  const target = event.target;
  const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
  const editable =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    (target && target.isContentEditable) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey;

  if (editable) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === ' ' || key === 'k') {
    event.preventDefault();
    const result = await audio.togglePlayPause(Number(gainSlider.value));
    setStatus(result.message);
  } else if (key === 'r') {
    event.preventDefault();
    const result = await audio.restart(Number(gainSlider.value));
    setStatus(result.message);
  } else if (key === 'f') {
    event.preventDefault();
    await toggleFullscreen();
  }
});

audioPlayer.addEventListener('play', () => {
  if (audio.audioMode === 'file') {
    setStatus('Audio file playing.');
  }
});

audioPlayer.addEventListener('pause', () => {
  if (audio.audioMode === 'file') {
    setStatus('Audio file paused.');
  }
});

audioPlayer.addEventListener('error', () => {
  setStatus('Audio file could not be decoded by the browser.');
});

const clock = new THREE.Clock();
animate();

function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();

  const hasFrame = audio.processFrame();
  if (!hasFrame) {
    audio.decayNoFrame();
    uiState.excitement *= 0.986;
  }

  const frame = audio.getFrame();

  if (hasFrame) {
    originalTorus.ingestFrame(frame);
    originalTorus.diffuse(Number(diffusionSlider.value), frame.bassEnergy);
    updateExcitement(frame);
  }

  updateMorphState();
  updateModeLabel();
  updateBlendState();

  originalTorus.update(elapsed, {
    heightScale: Number(heightSlider.value),
    centroidHz: frame.centroidHz,
    bassEnergy: frame.bassEnergy,
    beatPulse: frame.beatPulse,
  });
  freeFlowerTorus.update(elapsed, frame, uiState.useFreeTorus);

  drawBackgroundWave(elapsed, frame);
  drawCharacterWheel(elapsed, frame);
  updateStats(frame);

  controls.update();
  renderer.render(scene, camera);
}

function updateExcitement(frame) {
  const raw = clamp(frame.bassEnergy * 1.7 + frame.spectralFlux * 2.6 + frame.beatPulse * 0.9, 0, 1.8);
  uiState.excitement = uiState.excitement * 0.9 + (raw / 1.8) * 0.1;
}

function updateMorphState() {
  const threshold = Number(morphSlider.value);
  const ramp = smoothstep(threshold, threshold + 0.24, uiState.excitement);
  uiState.morph = uiState.morph * 0.88 + ramp * 0.12;
}

function updateModeLabel() {
  if (uiState.morph < 0.28) {
    uiState.modeLabel = uiState.useFreeTorus ? '2D (Flower Selected)' : '2D (Original Selected)';
    return;
  }

  if (uiState.morph < 0.78) {
    uiState.modeLabel = 'Hybrid';
    return;
  }

  if (uiState.useFreeTorus) {
    uiState.modeLabel = '3D Free-Group Flower';
  } else {
    uiState.modeLabel = '3D Cayley Torus';
  }
}

function updateBlendState() {
  const blend = uiState.useFreeTorus ? 1 : 0;
  const threeOpacity = clamp(0.18 + uiState.morph * 0.82, 0, 1);
  const flatOpacity = clamp(1 - uiState.morph * 0.9, 0.08, 1);

  viewCanvas.style.opacity = threeOpacity.toFixed(3);
  flatCanvas.style.opacity = flatOpacity.toFixed(3);

  originalTorus.setBlend(threeOpacity * (1 - blend));
  freeFlowerTorus.setBlend(threeOpacity * blend);
}

function updateTorusToggleUI() {
  if (uiState.useFreeTorus) {
    torusToggleState.textContent = 'Free-Group Flower Active';
    torusToggleBtn.textContent = 'Switch To Original Torus';
  } else {
    torusToggleState.textContent = 'Original Torus Active';
    torusToggleBtn.textContent = 'Switch To Free-Group Flower';
  }
}

function drawCharacterWheel(elapsed, frame) {
  if (!flatCtx) {
    return;
  }

  const width = flatCanvas.clientWidth;
  const height = flatCanvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }

  const cx = width * 0.5;
  const cy = height * 0.52;
  const baseRadius = Math.min(width, height) * 0.23;
  const guideOpacity = 0.14 + (1 - uiState.morph) * 0.25;

  flatCtx.clearRect(0, 0, width, height);
  flatCtx.fillStyle = `rgba(6, 20, 25, ${(0.1 + uiState.morph * 0.18).toFixed(3)})`;
  flatCtx.fillRect(0, 0, width, height);

  flatCtx.strokeStyle = `rgba(195, 234, 242, ${guideOpacity.toFixed(3)})`;
  flatCtx.lineWidth = 1.2;
  flatCtx.beginPath();
  flatCtx.arc(cx, cy, baseRadius, 0, TWO_PI);
  flatCtx.stroke();

  flatCtx.beginPath();
  flatCtx.arc(cx, cy, baseRadius * 0.66, 0, TWO_PI);
  flatCtx.stroke();

  flatCtx.beginPath();
  flatCtx.moveTo(cx - baseRadius * 1.1, cy);
  flatCtx.lineTo(cx + baseRadius * 1.1, cy);
  flatCtx.moveTo(cx, cy - baseRadius * 1.1);
  flatCtx.lineTo(cx, cy + baseRadius * 1.1);
  flatCtx.stroke();

  const orbitPoints = [];
  for (let k = 0; k < CHARACTER_COUNT; k += 1) {
    const amp = frame.charAmpSmooth[k];
    const phase = frame.charPhase[k];
    const modeAngle = -Math.PI / 2 + (k / CHARACTER_COUNT) * TWO_PI;
    const spokeStart = baseRadius * 0.64;
    const spokeLength = 6 + amp * (baseRadius * 0.9);
    const sx = cx + Math.cos(modeAngle) * spokeStart;
    const sy = cy + Math.sin(modeAngle) * spokeStart;
    const ex = cx + Math.cos(modeAngle) * (spokeStart + spokeLength);
    const ey = cy + Math.sin(modeAngle) * (spokeStart + spokeLength);

    const hue = Math.round((((phase / TWO_PI + 0.54) % 1) + 1) % 1 * 360);
    flatCtx.strokeStyle = `hsla(${hue}, 92%, ${42 + amp * 34}%, ${0.16 + amp * 0.78})`;
    flatCtx.lineWidth = 1 + amp * 2.1;
    flatCtx.beginPath();
    flatCtx.moveTo(sx, sy);
    flatCtx.lineTo(ex, ey);
    flatCtx.stroke();

    const shiftAngle = phase + (TWO_PI * (k + 1) * frame.shiftSamples) / FFT_SIZE + elapsed * 0.03;
    const orbitRadius = baseRadius * (0.09 + amp * 0.8);
    const ox = cx + Math.cos(shiftAngle) * orbitRadius;
    const oy = cy + Math.sin(shiftAngle) * orbitRadius;
    orbitPoints.push({ x: ox, y: oy });

    flatCtx.fillStyle = `hsla(${hue}, 92%, ${48 + amp * 30}%, ${0.35 + amp * 0.6})`;
    flatCtx.beginPath();
    flatCtx.arc(ox, oy, 1.2 + amp * 3.3, 0, TWO_PI);
    flatCtx.fill();
  }

  if (orbitPoints.length > 0) {
    flatCtx.beginPath();
    flatCtx.moveTo(orbitPoints[0].x, orbitPoints[0].y);
    for (let i = 1; i < orbitPoints.length; i += 1) {
      flatCtx.lineTo(orbitPoints[i].x, orbitPoints[i].y);
    }
    flatCtx.closePath();
  }
  flatCtx.strokeStyle = `rgba(255, 197, 124, ${(0.2 + (1 - uiState.morph) * 0.35).toFixed(3)})`;
  flatCtx.lineWidth = 1.3;
  flatCtx.stroke();

  const centerRadius = 10 + frame.symmetryScore * 18;
  flatCtx.fillStyle = `rgba(255, 122, 24, ${(0.25 + frame.symmetryScore * 0.55).toFixed(3)})`;
  flatCtx.beginPath();
  flatCtx.arc(cx, cy, centerRadius, 0, TWO_PI);
  flatCtx.fill();
}

function drawBackgroundWave(elapsed, frame) {
  if (!bgCtx) {
    return;
  }

  const width = bgCanvas.clientWidth;
  const height = bgCanvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }

  const userOpacity = Number(bgWaveOpacitySlider.value);
  const fade = frame.hasSignal ? 0.14 : 0.22;
  bgCtx.fillStyle = `rgba(2, 4, 6, ${fade})`;
  bgCtx.fillRect(0, 0, width, height);

  const centers = [0.34, 0.5, 0.66];
  const colors = [
    [205, 238, 245],
    [174, 229, 222],
    [255, 217, 188],
  ];

  for (let layer = 0; layer < centers.length; layer += 1) {
    const [r, g, b] = colors[layer];
    const alpha = clamp(userOpacity * (0.26 + layer * 0.2 + frame.spectralFlux * 0.4), 0, 0.82);
    const centerY = height * centers[layer];
    const amp = height * (0.08 + frame.bassEnergy * 0.36 + layer * 0.05);

    bgCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    bgCtx.lineWidth = 1 + layer * 0.7;
    bgCtx.beginPath();

    for (let x = 0; x <= width; x += 2) {
      const sampleIndex = Math.floor((x / width) * (FFT_SIZE - 1));
      let sample = frame.timeBuffer[sampleIndex] || 0;
      if (!frame.hasSignal) {
        sample = Math.sin(x * 0.011 + elapsed * (0.7 + layer * 0.2)) * 0.07;
      }

      const ripple = Math.sin(x * 0.003 + elapsed * (0.13 + layer * 0.08)) * 2.2;
      const y = centerY + sample * amp + ripple;
      if (x === 0) {
        bgCtx.moveTo(x, y);
      } else {
        bgCtx.lineTo(x, y);
      }
    }

    bgCtx.stroke();
  }
}

function updateStats(frame) {
  centroidStat.textContent = `${Math.round(frame.centroidHz)} Hz`;
  fluxStat.textContent = frame.spectralFlux.toFixed(3);
  bassStat.textContent = frame.bassEnergy.toFixed(3);
  beatStat.textContent = frame.beatPulse > 0.25 ? 'Yes' : 'No';
  symmetryStat.textContent = frame.symmetryScore.toFixed(2);
  modeStat.textContent = uiState.modeLabel;
  if (modeNarrative) {
    modeNarrative.textContent =
      `Time-Shift Characters of Z_N. Excitement ${uiState.excitement.toFixed(2)} | ` +
      `Shift symmetry ${frame.symmetryScore.toFixed(2)} | ${uiState.modeLabel}.`;
  }
}

function setCanvasSize() {
  const wrap = viewCanvas.parentElement;
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);

  const dpr = Math.min(window.devicePixelRatio, 2);

  bgCanvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  bgCanvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  bgCanvas.style.width = `${window.innerWidth}px`;
  bgCanvas.style.height = `${window.innerHeight}px`;
  if (bgCtx) {
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.fillStyle = 'rgba(2, 4, 6, 1)';
    bgCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }

  flatCanvas.width = Math.max(1, Math.floor(width * dpr));
  flatCanvas.height = Math.max(1, Math.floor(height * dpr));
  flatCanvas.style.width = `${width}px`;
  flatCanvas.style.height = `${height}px`;
  if (flatCtx) {
    flatCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

async function toggleFullscreen() {
  const target = document.querySelector('.viewport-wrap');
  if (!target) {
    return;
  }

  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }

  await target.requestFullscreen();
}

function setStatus(message) {
  statusEl.textContent = message;
}
