import { clamp, TWO_PI } from './math-utils.js';

export function createFFTPlan(size) {
  const levels = Math.log2(size);
  if (Math.floor(levels) !== levels) {
    throw new Error('FFT size must be power of two.');
  }

  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    reverse[i] = reverseBits(i, levels);
  }

  return {
    size,
    reverse,
  };
}

export function fftInPlace(re, im, plan) {
  const n = plan.size;
  for (let i = 0; i < n; i += 1) {
    const j = plan.reverse[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;

      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >>> 1;
    const theta = -TWO_PI / size;
    const multRe = Math.cos(theta);
    const multIm = Math.sin(theta);

    for (let start = 0; start < n; start += size) {
      let wr = 1;
      let wi = 0;

      for (let i = 0; i < half; i += 1) {
        const even = start + i;
        const odd = even + half;

        const oddRe = re[odd] * wr - im[odd] * wi;
        const oddIm = re[odd] * wi + im[odd] * wr;

        re[odd] = re[even] - oddRe;
        im[odd] = im[even] - oddIm;
        re[even] += oddRe;
        im[even] += oddIm;

        const nextWr = wr * multRe - wi * multIm;
        wi = wr * multIm + wi * multRe;
        wr = nextWr;
      }
    }
  }
}

export function buildLogBands(sampleRate, fftSize, count) {
  const nyquist = sampleRate / 2;
  const minHz = 30;
  const maxHz = Math.min(17000, nyquist);
  const starts = new Uint16Array(count);
  const ends = new Uint16Array(count);
  const centers = new Float32Array(count);
  const maxBin = fftSize / 2 - 1;

  for (let i = 0; i < count; i += 1) {
    const t0 = i / count;
    const t1 = (i + 1) / count;
    const f0 = minHz * (maxHz / minHz) ** t0;
    const f1 = minHz * (maxHz / minHz) ** t1;
    let start = Math.floor((f0 / nyquist) * (fftSize / 2));
    let end = Math.ceil((f1 / nyquist) * (fftSize / 2));

    start = clamp(start, 1, maxBin - 1);
    end = clamp(end, start + 1, maxBin);

    starts[i] = start;
    ends[i] = end;
    centers[i] = Math.sqrt(f0 * f1);
  }

  return { starts, ends, centers };
}

export function buildCharacterBins(count, maxBin) {
  const bins = new Uint16Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const warped = t * t;
    bins[i] = clamp(1 + Math.floor(warped * (maxBin - 1)), 1, maxBin);
  }
  return bins;
}

export function computeLagOneSymmetry(samples) {
  let corr = 0;
  let energy = 1e-8;
  for (let i = 1; i < samples.length; i += 1) {
    const current = samples[i];
    const prev = samples[i - 1];
    corr += current * prev;
    energy += current * current;
  }
  return clamp(0.5 + 0.5 * (corr / energy), 0, 1);
}

function reverseBits(value, bits) {
  let result = 0;
  for (let i = 0; i < bits; i += 1) {
    result = (result << 1) | (value & 1);
    value >>>= 1;
  }
  return result;
}
