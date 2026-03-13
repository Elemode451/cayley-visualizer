import { buildCharacterBins, buildLogBands, computeLagOneSymmetry, createFFTPlan, fftInPlace } from './fft-utils.js';

export class AudioEngine {
  constructor({ audioElement, fftSize, bandCount, characterCount, twoPi }) {
    this.audioElement = audioElement;
    this.fftSize = fftSize;
    this.bandCount = bandCount;
    this.characterCount = characterCount;
    this.twoPi = twoPi;

    this.audioContext = null;
    this.analyser = null;
    this.gainNode = null;
    this.sourceNode = null;
    this.fileSourceNode = null;
    this.micStream = null;
    this.audioMode = null;
    this.currentObjectUrl = null;
    this.currentLabel = '';

    this.bands = null;
    this.characterBins = buildCharacterBins(characterCount, fftSize / 2 - 1);
    this.fftPlan = createFFTPlan(fftSize);

    this.fftRe = new Float32Array(fftSize);
    this.fftIm = new Float32Array(fftSize);
    this.fftWindow = new Float32Array(fftSize);
    this.timeBuffer = new Float32Array(fftSize);

    this.bandAmpRaw = new Float32Array(bandCount);
    this.bandAmpSmooth = new Float32Array(bandCount);
    this.bandPhase = new Float32Array(bandCount);
    this.prevBandAmp = new Float32Array(bandCount);

    this.charAmpRaw = new Float32Array(characterCount);
    this.charAmpSmooth = new Float32Array(characterCount);
    this.charPhase = new Float32Array(characterCount);

    this.runningPeak = 1e-6;
    this.charPeak = 1e-6;
    this.bassAvg = 0;
    this.fluxAvg = 0;
    this.beatCooldown = 0;
    this.beatPulse = 0;
    this.centroidHz = 0;
    this.spectralFlux = 0;
    this.bassEnergy = 0;
    this.symmetryScore = 0;
    this.hasSignal = false;
    this.shiftSamples = 0;
    this.lastBeat = false;
    this.frameCount = 0;

    for (let i = 0; i < fftSize; i += 1) {
      this.fftWindow[i] = 0.5 * (1 - Math.cos((twoPi * i) / (fftSize - 1)));
    }
  }

  async ensureReady(gain = 1) {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0;

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = gain;

      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (!this.bands) {
      this.bands = buildLogBands(this.audioContext.sampleRate, this.fftSize, this.bandCount);
    }
  }

  setGain(value) {
    if (this.gainNode) {
      this.gainNode.gain.value = Number(value);
    }
  }

  async startMic(gain = 1) {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, message: 'Microphone access is not supported in this browser.' };
    }

    try {
      await this.ensureReady(gain);
      this.cleanupSource();

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
        video: false,
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
      this.sourceNode.connect(this.analyser);
      this.audioMode = 'mic';
      this.currentLabel = 'Microphone';
      this.audioElement.pause();
      return { ok: true, message: 'Microphone input active.' };
    } catch (error) {
      return { ok: false, message: `Microphone error: ${error.message}` };
    }
  }

  async loadFile(file, gain = 1) {
    try {
      await this.ensureReady(gain);
      this.cleanupSource();

      if (this.currentObjectUrl) {
        URL.revokeObjectURL(this.currentObjectUrl);
        this.currentObjectUrl = null;
      }

      const objectUrl = URL.createObjectURL(file);
      this.currentObjectUrl = objectUrl;
      this.audioElement.src = objectUrl;
      this.audioElement.loop = true;
      this.audioElement.load();
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      await this.waitForMediaReady(12000);
      this.currentLabel = file.name;

      if (!this.fileSourceNode) {
        this.fileSourceNode = this.audioContext.createMediaElementSource(this.audioElement);
      }

      this.sourceNode = this.fileSourceNode;
      this.connectSourceToAnalyser();
      this.audioMode = 'file';
      return { ok: true, message: `Loaded: ${file.name}. Press Play, Space, or K to start.` };
    } catch (error) {
      this.audioMode = null;
      this.currentLabel = '';
      return { ok: false, message: `File playback error: ${error.message || 'unsupported/corrupt audio file'}` };
    }
  }

  async loadUrl(url, gain = 1, label = 'stream') {
    try {
      await this.ensureReady(gain);
      this.cleanupSource();

      if (this.currentObjectUrl) {
        URL.revokeObjectURL(this.currentObjectUrl);
        this.currentObjectUrl = null;
      }

      this.audioElement.src = url;
      this.audioElement.loop = true;
      this.audioElement.load();
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      await this.waitForMediaReady(16000);
      this.currentLabel = label;

      if (!this.fileSourceNode) {
        this.fileSourceNode = this.audioContext.createMediaElementSource(this.audioElement);
      }

      this.sourceNode = this.fileSourceNode;
      this.connectSourceToAnalyser();
      this.audioMode = 'file';
      return { ok: true, message: `Loaded stream: ${label}. Press Play, Space, or K to start.` };
    } catch (error) {
      this.audioMode = null;
      this.currentLabel = '';
      return { ok: false, message: `URL playback error: ${error.message || 'stream unavailable or blocked'}` };
    }
  }

  async togglePlayPause(gain = 1) {
    if (!this.audioElement.src) {
      return { ok: false, message: 'Load a file first.' };
    }

    await this.ensureReady(gain);
    if (!this.sourceNode && this.fileSourceNode) {
      this.sourceNode = this.fileSourceNode;
      this.connectSourceToAnalyser();
    }

    if (this.audioElement.paused) {
      try {
        await this.audioElement.play();
        return { ok: true, message: `Playing: ${this.getFilename()}` };
      } catch (error) {
        return { ok: false, message: `Could not start playback: ${error.message}` };
      }
    }

    this.audioElement.pause();
    return { ok: true, message: 'Paused audio file.' };
  }

  async restart(gain = 1) {
    if (!this.audioElement.src) {
      return { ok: false, message: 'Load a file first.' };
    }

    await this.ensureReady(gain);
    this.audioElement.currentTime = 0;
    try {
      await this.audioElement.play();
      return { ok: true, message: `Restarted: ${this.getFilename()}` };
    } catch (error) {
      return { ok: false, message: `Could not restart playback: ${error.message}` };
    }
  }

  cleanupSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
    }

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }

    this.sourceNode = null;
  }

  connectSourceToAnalyser() {
    if (!this.sourceNode || !this.analyser) {
      return;
    }

    try {
      this.sourceNode.connect(this.analyser);
    } catch (error) {
      const message = String(error?.message || error).toLowerCase();
      if (!message.includes('already')) {
        throw error;
      }
    }
  }

  async waitForMediaReady(timeoutMs = 12000) {
    if (this.audioElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    await new Promise((resolve, reject) => {
      let finished = false;
      let timeoutId = null;

      const done = (fn, value) => {
        if (finished) {
          return;
        }
        finished = true;
        this.audioElement.removeEventListener('loadedmetadata', onReady);
        this.audioElement.removeEventListener('canplay', onReady);
        this.audioElement.removeEventListener('error', onError);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        fn(value);
      };

      const onReady = () => done(resolve);
      const onError = () => {
        const code = this.audioElement.error?.code;
        const reason =
          code === 1
            ? 'load aborted'
            : code === 2
              ? 'network error'
              : code === 3
                ? 'decode error'
                : code === 4
                  ? 'unsupported format/source'
                  : 'unknown media error';
        done(reject, new Error(reason));
      };

      this.audioElement.addEventListener('loadedmetadata', onReady, { once: true });
      this.audioElement.addEventListener('canplay', onReady, { once: true });
      this.audioElement.addEventListener('error', onError, { once: true });

      timeoutId = setTimeout(() => {
        done(reject, new Error('timed out while loading audio'));
      }, timeoutMs);
    });
  }

  processFrame() {
    if (!this.analyser || !this.sourceNode || !this.bands) {
      this.lastBeat = false;
      return false;
    }

    this.frameCount += 1;
    if (this.frameCount % 2 !== 0) {
      this.lastBeat = false;
      return false;
    }

    this.analyser.getFloatTimeDomainData(this.timeBuffer);
    for (let i = 0; i < this.fftSize; i += 1) {
      this.fftRe[i] = this.timeBuffer[i] * this.fftWindow[i];
      this.fftIm[i] = 0;
    }

    fftInPlace(this.fftRe, this.fftIm, this.fftPlan);

    let maxBand = 0;
    let maxChar = 0;
    let centroidNumerator = 0;
    let centroidDenominator = 0;
    let bassAccumulator = 0;
    let bassCount = 0;
    let flux = 0;

    for (let c = 0; c < this.characterCount; c += 1) {
      const bin = this.characterBins[c];
      const re = this.fftRe[bin];
      const im = this.fftIm[bin];
      const mag = Math.hypot(re, im);
      this.charAmpRaw[c] = mag;
      this.charPhase[c] = Math.atan2(im, re);
      if (mag > maxChar) {
        maxChar = mag;
      }
    }

    for (let b = 0; b < this.bandCount; b += 1) {
      const start = this.bands.starts[b];
      const end = this.bands.ends[b];
      let magSum = 0;
      let phaseRe = 0;
      let phaseIm = 0;

      for (let k = start; k < end; k += 1) {
        const re = this.fftRe[k];
        const im = this.fftIm[k];
        const mag = Math.hypot(re, im);
        magSum += mag;
        phaseRe += re;
        phaseIm += im;
      }

      const size = end - start;
      const avgMag = size > 0 ? magSum / size : 0;
      this.bandAmpRaw[b] = avgMag;
      this.bandPhase[b] = Math.atan2(phaseIm, phaseRe);
      if (avgMag > maxBand) {
        maxBand = avgMag;
      }
    }

    this.runningPeak = Math.max(this.runningPeak * 0.992, maxBand);
    this.charPeak = Math.max(this.charPeak * 0.992, maxChar);

    for (let c = 0; c < this.characterCount; c += 1) {
      const normalized = this.charAmpRaw[c] / (this.charPeak + 1e-8);
      const compressed = Math.log1p(14 * normalized) / Math.log1p(14);
      this.charAmpSmooth[c] = this.charAmpSmooth[c] * 0.72 + compressed * 0.28;
    }

    for (let b = 0; b < this.bandCount; b += 1) {
      const normalized = this.bandAmpRaw[b] / (this.runningPeak + 1e-8);
      const compressed = Math.log1p(26 * normalized) / Math.log1p(26);
      this.bandAmpSmooth[b] = this.bandAmpSmooth[b] * 0.68 + compressed * 0.32;

      const previous = this.prevBandAmp[b];
      flux += Math.max(0, this.bandAmpSmooth[b] - previous);
      this.prevBandAmp[b] = this.bandAmpSmooth[b];

      const centerHz = this.bands.centers[b];
      centroidNumerator += centerHz * this.bandAmpSmooth[b];
      centroidDenominator += this.bandAmpSmooth[b];

      if (centerHz < 185) {
        bassAccumulator += this.bandAmpSmooth[b];
        bassCount += 1;
      }
    }

    this.centroidHz = centroidDenominator > 0 ? centroidNumerator / centroidDenominator : 0;
    this.spectralFlux = flux;
    this.bassEnergy = bassCount > 0 ? bassAccumulator / bassCount : 0;
    this.symmetryScore = computeLagOneSymmetry(this.timeBuffer);
    this.hasSignal = this.bassEnergy > 0.003 || this.spectralFlux > 0.01;

    this.bassAvg = this.bassAvg * 0.95 + this.bassEnergy * 0.05;
    this.fluxAvg = this.fluxAvg * 0.95 + this.spectralFlux * 0.05;

    if (this.beatCooldown > 0) {
      this.beatCooldown -= 1;
    }

    const beat =
      this.bassEnergy > this.bassAvg * 1.35 &&
      this.spectralFlux > this.fluxAvg * 1.1 &&
      this.bassEnergy > 0.08 &&
      this.beatCooldown <= 0;

    if (beat) {
      this.beatCooldown = 14;
      this.beatPulse = Math.min(1, this.beatPulse + 0.42);
    } else {
      this.beatPulse *= 0.92;
    }

    this.shiftSamples = (this.shiftSamples + (beat ? 10 : 6)) % this.fftSize;
    this.lastBeat = beat;
    return true;
  }

  decayNoFrame() {
    this.beatPulse *= 0.95;
  }

  getFrame() {
    return {
      beat: this.lastBeat,
      beatPulse: this.beatPulse,
      centroidHz: this.centroidHz,
      spectralFlux: this.spectralFlux,
      bassEnergy: this.bassEnergy,
      symmetryScore: this.symmetryScore,
      hasSignal: this.hasSignal,
      shiftSamples: this.shiftSamples,
      timeBuffer: this.timeBuffer,
      bandAmpSmooth: this.bandAmpSmooth,
      bandPhase: this.bandPhase,
      charAmpSmooth: this.charAmpSmooth,
      charPhase: this.charPhase,
    };
  }

  getFilename() {
    if (this.currentLabel) {
      return this.currentLabel;
    }

    try {
      const url = new URL(this.audioElement.src);
      const chunks = url.pathname.split('/');
      return chunks[chunks.length - 1] || 'audio source';
    } catch {
      return 'audio source';
    }
  }
}
