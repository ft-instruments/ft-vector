// Small numeric helpers shared by the DSP. No allocation, no browser APIs.

/** Rational tanh approximation, good to ~1e-3 over |x| < 3 and clamped beyond. */
export function tanhf(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

/** Soft clipper with unit slope at 0 and hard limit at ±1. */
export function softClip(x: number): number {
  if (x > 1.5) return 1;
  if (x < -1.5) return -1;
  return x - (x * x * x) * 0.148148; // x - 4/27 x^3, peaks at ±1 for x = ±1.5
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** xorshift32; deterministic so offline renders are repeatable. */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) { this.s = seed | 0 || 1; }
  next(): number {
    let x = this.s;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s = x | 0;
    return ((x >>> 0) / 4294967296);
  }
  /** -1..1 */
  bi(): number { return this.next() * 2 - 1; }
}

/** One-pole parameter smoother (exponential glide to target). */
export class Smooth {
  value: number;
  target: number;
  private coef: number;
  constructor(initial: number, sampleRate: number, ms = 20) {
    this.value = this.target = initial;
    this.coef = 1 - Math.exp(-1 / (ms * 1e-3 * sampleRate));
  }
  set(t: number): void { this.target = t; }
  jump(t: number): void { this.value = this.target = t; }
  tick(): number { return (this.value += (this.target - this.value) * this.coef); }
  get settled(): boolean { return Math.abs(this.target - this.value) < 1e-6; }
}

/** Fractional-delay read with linear interpolation from a circular buffer. */
export function readDelay(buf: Float32Array, writeIdx: number, delay: number): number {
  const len = buf.length;
  let r = writeIdx - delay;
  while (r < 0) r += len;
  const i0 = r | 0;
  const frac = r - i0;
  let i1 = i0 + 1; if (i1 >= len) i1 -= len;
  return buf[i0] + (buf[i1] - buf[i0]) * frac;
}

/** DC blocker (first-order high-pass at ~10 Hz). */
export class DCBlock {
  private x1 = 0; private y1 = 0; private r: number;
  constructor(sampleRate: number, hz = 10) { this.r = 1 - (2 * Math.PI * hz) / sampleRate; }
  tick(x: number): number {
    const y = x - this.x1 + this.r * this.y1;
    this.x1 = x; this.y1 = y;
    return y;
  }
}

/** One-pole low-pass, coefficient from a cutoff in Hz. */
export class OnePoleLP {
  z = 0; a = 0.1;
  constructor(sampleRate: number, hz: number) { this.set(sampleRate, hz); }
  set(sampleRate: number, hz: number): void { this.a = 1 - Math.exp(-2 * Math.PI * hz / sampleRate); }
  tick(x: number): number { return (this.z += (x - this.z) * this.a); }
}

export class OnePoleHP {
  private lp: OnePoleLP;
  constructor(sampleRate: number, hz: number) { this.lp = new OnePoleLP(sampleRate, hz); }
  set(sampleRate: number, hz: number): void { this.lp.set(sampleRate, hz); }
  tick(x: number): number { return x - this.lp.tick(x); }
}
