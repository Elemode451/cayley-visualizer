import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AudioEngine } from './src/audio-engine.js';
import { FourierImageView } from './src/fourier-image-view.js';
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
const FREE_GROUP_BASE_GENERATORS = ['a', 'b'];
const FREE_GROUP_VECTOR_DIMENSIONS = 3;
const VIEWPORT_PRESETS = [
  { id: 'auto', label: 'Auto Fill', aspectRatio: null, renderWidth: null, renderHeight: null },
  { id: 'phone-1080x1920', label: 'Phone Portrait 1080x1920', aspectRatio: 1080 / 1920, renderWidth: 1080, renderHeight: 1920 },
];
const MODE_CONFIG = [
  { id: 'original', label: 'Original Torus', button: 'Switch To Free-Group Flower' },
  { id: 'flower', label: 'Free-Group Flower', button: 'Switch To Fourier Image Waves' },
  { id: 'image', label: 'Fourier Image Waves', button: 'Switch To Original Torus' },
];

const bgCanvas = document.getElementById('bgWave');
const viewCanvas = document.getElementById('view');
const flatCanvas = document.getElementById('flatView');
const audioFileInput = document.getElementById('audioFile');
const youtubeUrlInput = document.getElementById('youtubeUrlInput');
const loadYoutubeBtn = document.getElementById('loadYoutubeBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const restartBtn = document.getElementById('restartBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const viewportPresetSelect = document.getElementById('viewportPreset');
const gpuPriorityToggle = document.getElementById('gpuPriorityToggle');
const gainSlider = document.getElementById('gainSlider');
const diffusionSlider = document.getElementById('diffusionSlider');
const heightSlider = document.getElementById('heightSlider');
const morphSlider = document.getElementById('morphSlider');
const bgWaveOpacitySlider = document.getElementById('bgWaveOpacitySlider');
const bgWaveEnabled = document.getElementById('bgWaveEnabled');
const flowerHueBlendSlider = document.getElementById('flowerHueBlendSlider');
const flowerSpreadSlider = document.getElementById('flowerSpreadSlider');
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
  modeIndex: 0,
  viewportPresetId: viewportPresetSelect?.value || 'auto',
  gpuPriorityEnabled: Boolean(gpuPriorityToggle?.checked ?? false),
  bgWaveEnabled: Boolean(bgWaveEnabled?.checked ?? true),
  bgWaveCleared: false,
  flatViewCleared: false,
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

let renderer = createRenderer(uiState.gpuPriorityEnabled ? 'high-performance' : 'default');
let controls = createControls(renderer);

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
  baseGenerators: FREE_GROUP_BASE_GENERATORS,
  vectorDimensions: FREE_GROUP_VECTOR_DIMENSIONS,
});

const fourierImageView = new FourierImageView({
  scene,
  bands: GRID_V,
  columns: 560,
  width: 8.2,
  height: 4.9,
});

setCanvasSize();
window.addEventListener('resize', setCanvasSize);
window.addEventListener('error', (event) => {
  setStatus(`Runtime error: ${event.error?.message || event.message}`);
});
window.addEventListener('unhandledrejection', (event) => {
  const message = event?.reason?.message || String(event?.reason || 'unknown error');
  setStatus(`Async error: ${message}`);
});
updateTorusToggleUI();
updateBlendState();
updateStats(audio.getFrame());

audioFileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  setStatus(`Loading file: ${file.name}...`);
  const result = await audio.loadFile(file, Number(gainSlider.value));
  if (result.ok) {
    playPauseBtn.disabled = false;
    restartBtn.disabled = false;
    setStatus(`${result.message} Building Fourier image...`);
    try {
      await fourierImageView.loadSongImageFromFile(file, audio.audioContext);
      setStatus(`${result.message} Fourier image ready.`);
    } catch (error) {
      fourierImageView.clearStaticImage();
      const reason = error?.message || 'image extraction failed';
      setStatus(`${result.message} (Fourier image fallback to live mode: ${reason})`);
    }
    return;
  }
  fourierImageView.clearStaticImage();
  setStatus(result.message);
});

loadYoutubeBtn?.addEventListener('click', async () => {
  const rawUrl = (youtubeUrlInput?.value || '').trim();
  if (!rawUrl) {
    setStatus('Paste a YouTube URL first.');
    return;
  }

  loadYoutubeBtn.disabled = true;
  setStatus('Resolving YouTube stream...');

  try {
    const response = await fetch('/api/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || `YouTube load failed (${response.status}).`;
      setStatus(message);
      return;
    }

    const result = await audio.loadUrl(payload.streamUrl, Number(gainSlider.value), payload.title || 'YouTube Stream');
    if (result.ok) {
      playPauseBtn.disabled = false;
      restartBtn.disabled = false;
      fourierImageView.clearStaticImage();
    }
    setStatus(result.message);
  } catch (error) {
    setStatus(
      `YouTube load failed: ${error.message}. If you are using python http.server, run this app with node server.mjs instead.`
    );
  } finally {
    loadYoutubeBtn.disabled = false;
  }
});

youtubeUrlInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadYoutubeBtn?.click();
  }
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

bgWaveEnabled?.addEventListener('change', () => {
  uiState.bgWaveEnabled = Boolean(bgWaveEnabled.checked);
  if (uiState.bgWaveEnabled) {
    uiState.bgWaveCleared = false;
  }
});

viewportPresetSelect?.addEventListener('change', () => {
  uiState.viewportPresetId = viewportPresetSelect.value;
  setCanvasSize();
  const preset = getViewportPreset();
  setStatus(
    preset.id === 'auto'
      ? 'Viewport preset: Auto Fill.'
      : `Viewport preset: ${preset.label}. Fullscreen keeps a centered 9:16 stage.`
  );
});

gpuPriorityToggle?.addEventListener('change', async () => {
  const enabled = Boolean(gpuPriorityToggle.checked);
  gpuPriorityToggle.disabled = true;

  try {
    await setGpuPriorityMode(enabled);
  } catch (error) {
    uiState.gpuPriorityEnabled = !enabled;
    gpuPriorityToggle.checked = uiState.gpuPriorityEnabled;
    setStatus(`GPU Priority Mode failed: ${error?.message || error}`);
  } finally {
    gpuPriorityToggle.disabled = false;
  }
});

function toggleTorusMode() {
  uiState.modeIndex = (uiState.modeIndex + 1) % MODE_CONFIG.length;
  const mode = getActiveMode();

  if (mode.id !== 'original') {
    uiState.excitement = Math.max(uiState.excitement, Number(morphSlider.value) + 0.35);
    uiState.morph = Math.max(uiState.morph, 0.9);
  }

  setStatus(`3D mode: ${mode.label}`);
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
    tag === 'SELECT' ||
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
  const code = audioPlayer.error?.code;
  const codeLabel =
    code === 1
      ? 'aborted'
      : code === 2
        ? 'network error'
        : code === 3
          ? 'decode error'
          : code === 4
            ? 'unsupported format/source'
            : 'unknown media error';
  setStatus(`Audio load/playback failed (${codeLabel}). Try MP3/WAV, or re-export the file.`);
});

const clock = new THREE.Clock();
animate();

function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();
  const activeMode = getActiveMode();

  const hasFrame = audio.processFrame();
  if (!hasFrame) {
    audio.decayNoFrame();
    uiState.excitement *= 0.986;
  }

  const frame = audio.getFrame();

  if (hasFrame) {
    if (activeMode.id === 'original') {
      originalTorus.ingestFrame(frame);
      originalTorus.diffuse(Number(diffusionSlider.value), frame.bassEnergy);
    }
    updateExcitement(frame);
  }

  updateMorphState();
  updateModeLabel();
  updateBlendState();

  const needsOriginal = activeMode.id === 'original';
  const needsFlower = activeMode.id === 'flower';
  const needsImage = activeMode.id === 'image';

  if (needsOriginal) {
    originalTorus.update(elapsed, {
      heightScale: Number(heightSlider.value),
      centroidHz: frame.centroidHz,
      bassEnergy: frame.bassEnergy,
      beatPulse: frame.beatPulse,
    });
  }

  if (needsFlower) {
    freeFlowerTorus.update(elapsed, frame, {
      active: true,
      formMode: 'projected',
      hueBlend: Number(flowerHueBlendSlider?.value || 0),
      spread: Number(flowerSpreadSlider?.value || 1),
    });
  }

  if (needsImage) {
    fourierImageView.update(elapsed, frame, true);
  }

  if (uiState.bgWaveEnabled) {
    if (uiState.gpuPriorityEnabled) {
      clearBackgroundWave();
    } else {
      drawBackgroundWave(elapsed, frame);
      uiState.bgWaveCleared = false;
    }
  } else if (!uiState.bgWaveCleared) {
    clearBackgroundWave();
  }

  if (uiState.gpuPriorityEnabled) {
    clearFlatView();
  } else {
    drawCharacterWheel(elapsed, frame);
    uiState.flatViewCleared = false;
  }
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
  const mode = getActiveMode();
  if (uiState.morph < 0.28) {
    uiState.modeLabel = `2D (${mode.label} Selected)`;
    return;
  }

  if (uiState.morph < 0.78) {
    uiState.modeLabel = `Morph (${mode.label})`;
    return;
  }

  uiState.modeLabel = `3D ${mode.label}`;
}

function updateBlendState() {
  const mode = getActiveMode();
  const threeOpacity = uiState.gpuPriorityEnabled ? 1 : clamp(0.18 + uiState.morph * 0.82, 0, 1);
  const flatOpacity = uiState.gpuPriorityEnabled ? 0 : clamp(1 - uiState.morph * 0.9, 0.08, 1);

  viewCanvas.style.opacity = threeOpacity.toFixed(3);
  flatCanvas.style.opacity = flatOpacity.toFixed(3);
  bgCanvas.style.opacity = uiState.gpuPriorityEnabled ? '0' : '1';

  const originalBlend = mode.id === 'original' ? threeOpacity : 0;
  const flowerBlend = mode.id === 'flower' ? threeOpacity : 0;
  const imageBlend = mode.id === 'image' ? threeOpacity : 0;

  originalTorus.setBlend(originalBlend);
  freeFlowerTorus.setBlend(flowerBlend);
  fourierImageView.setBlend(imageBlend);
}

function updateTorusToggleUI() {
  const mode = getActiveMode();
  torusToggleState.textContent = `${mode.label} Active`;
  torusToggleBtn.textContent = mode.button;
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

function getActiveMode() {
  return MODE_CONFIG[uiState.modeIndex] || MODE_CONFIG[0];
}

function createRenderer(powerPreference) {
  const nextRenderer = new THREE.WebGLRenderer({
    canvas: viewCanvas,
    antialias: true,
    alpha: true,
    powerPreference,
  });
  nextRenderer.outputColorSpace = THREE.SRGBColorSpace;
  return nextRenderer;
}

function createControls(nextRenderer) {
  const nextControls = new OrbitControls(camera, nextRenderer.domElement);
  nextControls.enableDamping = true;
  nextControls.dampingFactor = 0.07;
  nextControls.minDistance = 4;
  nextControls.maxDistance = 36;
  nextControls.maxPolarAngle = Math.PI * 0.84;
  return nextControls;
}

async function setGpuPriorityMode(enabled) {
  if (uiState.gpuPriorityEnabled === enabled) {
    return;
  }

  uiState.gpuPriorityEnabled = enabled;
  renderer = rebuildRenderer(enabled ? 'high-performance' : 'default');
  controls = createControls(renderer);
  setCanvasSize();
  updateBlendState();

  if (enabled) {
    clearBackgroundWave();
    clearFlatView();
  }

  setStatus(
    enabled
      ? 'GPU Priority Mode enabled. Browser requested high-performance WebGL and CPU-heavy 2D overlays were disabled.'
      : 'GPU Priority Mode disabled. Restored the full mixed 2D/3D render path.'
  );
}

function rebuildRenderer(powerPreference) {
  const previousRenderer = renderer;
  const previousControls = controls;
  previousControls?.dispose();

  if (previousRenderer) {
    previousRenderer.dispose();
  }

  return createRenderer(powerPreference);
}

function setCanvasSize() {
  const wrap = viewCanvas.parentElement;
  if (!wrap) {
    return;
  }

  const wrapWidth = Math.max(1, wrap.clientWidth);
  const wrapHeight = Math.max(1, wrap.clientHeight);
  const stage = getViewportStage(wrapWidth, wrapHeight);
  camera.aspect = stage.displayWidth / stage.displayHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(1);
  renderer.setSize(stage.renderWidth, stage.renderHeight, false);
  applyCanvasStage(viewCanvas, stage);
  applyCanvasStage(flatCanvas, stage);

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

  flatCanvas.width = stage.renderWidth;
  flatCanvas.height = stage.renderHeight;
  if (flatCtx) {
    flatCtx.setTransform(stage.renderWidth / stage.displayWidth, 0, 0, stage.renderHeight / stage.displayHeight, 0, 0);
  }
}

function getViewportPreset() {
  return VIEWPORT_PRESETS.find((preset) => preset.id === uiState.viewportPresetId) || VIEWPORT_PRESETS[0];
}

function getViewportStage(boundsWidth, boundsHeight) {
  const preset = getViewportPreset();
  let displayWidth = boundsWidth;
  let displayHeight = boundsHeight;

  if (preset.aspectRatio) {
    const boundsAspect = boundsWidth / boundsHeight;
    if (boundsAspect > preset.aspectRatio) {
      displayHeight = boundsHeight;
      displayWidth = boundsHeight * preset.aspectRatio;
    } else {
      displayWidth = boundsWidth;
      displayHeight = boundsWidth / preset.aspectRatio;
    }
  }

  const clampedWidth = Math.max(1, Math.floor(displayWidth));
  const clampedHeight = Math.max(1, Math.floor(displayHeight));
  const dpr = Math.min(window.devicePixelRatio, 2);

  return {
    displayWidth: clampedWidth,
    displayHeight: clampedHeight,
    offsetLeft: Math.floor((boundsWidth - clampedWidth) * 0.5),
    offsetTop: Math.floor((boundsHeight - clampedHeight) * 0.5),
    renderWidth: preset.renderWidth || Math.max(1, Math.floor(clampedWidth * dpr)),
    renderHeight: preset.renderHeight || Math.max(1, Math.floor(clampedHeight * dpr)),
  };
}

function applyCanvasStage(canvas, stage) {
  canvas.style.width = `${stage.displayWidth}px`;
  canvas.style.height = `${stage.displayHeight}px`;
  canvas.style.left = `${stage.offsetLeft}px`;
  canvas.style.top = `${stage.offsetTop}px`;
  canvas.style.right = 'auto';
  canvas.style.bottom = 'auto';
}

function clearBackgroundWave() {
  if (!bgCtx) {
    return;
  }

  bgCtx.fillStyle = 'rgba(2, 4, 6, 1)';
  bgCtx.fillRect(0, 0, bgCanvas.clientWidth, bgCanvas.clientHeight);
  uiState.bgWaveCleared = true;
}

function clearFlatView() {
  if (!flatCtx) {
    return;
  }

  flatCtx.clearRect(0, 0, flatCanvas.clientWidth, flatCanvas.clientHeight);
  uiState.flatViewCleared = true;
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
