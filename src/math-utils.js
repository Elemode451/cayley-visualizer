export const TWO_PI = Math.PI * 2;

export function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

export function modulo(value, mod) {
  return ((value % mod) + mod) % mod;
}

export function wrapAngle(theta) {
  let out = theta % TWO_PI;
  if (out <= -Math.PI) out += TWO_PI;
  if (out > Math.PI) out -= TWO_PI;
  return out;
}

export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hslToRgb(h, s, l) {
  if (s <= 0) {
    return [l, l, l];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function hueToRgb(p, q, t) {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}
