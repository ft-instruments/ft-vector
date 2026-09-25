// Plate reverb: the same 8-line Householder FDN skeleton as Mycelia's hall,
// re-tuned as a digital plate — short, dense, bright, slightly metallic
// (light modulation only), with an optional gate that cuts the tail after
// a hold time, the drum-machine way.

import { readDelay } from './util.ts';

const N = 8;
const BASE = [449, 587, 701, 823, 937, 1063, 1187, 1301];   // samples at 48 kHz
const MOD_RATE = [0.7, 1.1, 0.9, 1.3, 0.8, 1.2, 1.0, 0.6];
const AP_MS = [1.1, 2.3, 3.7, 5.9];
const AP_G = 0.7;
const MAX_SCALE = 1.5;
const MOD_DEPTH = 1.5;        // samples

export class Plate {
  private lines: Float32Array[] = [];
  private idx = new Int32Array(N);
  private lengths = new Float64Array(N);
  private gains = new Float32Array(N);
  private lp = new Float32Array(N);
  private hp = new Float32Array(N);
  private modPhase = new Float32Array(N);
  private tmp = new Float32Array(N);
  private ap: Float32Array[] = [];
  private apIdx = new Int32Array(4);
  private pre: Float32Array;
  private preIdx = 0;
  private readonly fs: number;
  private curSize = -1; private curDecay = -1;
  private inEnv = 0; private gateEnv = 0; private gateHold = 0;

  constructor(sampleRate: number) {
    this.fs = sampleRate;
    const ratio = sampleRate / 48000;
    for (let i = 0; i < N; i++) {
      this.lines.push(new Float32Array(Math.ceil(BASE[i] * ratio * MAX_SCALE + MOD_DEPTH * 2 + 8)));
      this.modPhase[i] = i / N;
    }
    for (let i = 0; i < 4; i++) this.ap.push(new Float32Array(Math.max(2, Math.round(AP_MS[i] * 1e-3 * sampleRate))));
    this.pre = new Float32Array(Math.round(0.006 * sampleRate));
    this.setSize(0.5, 1.2);
  }

  clear(): void {
    for (const l of this.lines) l.fill(0);
    for (const a of this.ap) a.fill(0);
    this.pre.fill(0); this.lp.fill(0); this.hp.fill(0);
    this.inEnv = this.gateEnv = 0;
  }

  private setSize(size: number, decay: number): void {
    if (size === this.curSize && decay === this.curDecay) return;
    this.curSize = size; this.curDecay = decay;
    const scale = (0.5 + size) * this.fs / 48000;
    for (let i = 0; i < N; i++) {
      this.lengths[i] = BASE[i] * scale;
      this.gains[i] = Math.pow(10, (-3 * this.lengths[i]) / (decay * this.fs));
    }
  }

  private allpass(x: number, i: number): number {
    const buf = this.ap[i];
    let idx = this.apIdx[i];
    const d = buf[idx];
    const v = x - AP_G * d;
    buf[idx] = v;
    if (++idx >= buf.length) idx = 0;
    this.apIdx[i] = idx;
    return d + AP_G * v;
  }

  /** In place. `size` 0..1, `decay` seconds, `tone` 0..1, `gate` 0..1 (0 = off, else 20–400 ms hold), `mix` 0..1. */
  process(L: Float32Array, R: Float32Array, n: number, size: number, decay: number, tone: number, gate: number, mix: number): void {
    if (mix <= 0) return;
    this.setSize(size, decay);
    const fs = this.fs;
    const lines = this.lines, idx = this.idx, lengths = this.lengths, gains = this.gains;
    const lp = this.lp, hp = this.hp, tmp = this.tmp, modPhase = this.modPhase;
    const lpA = 1 - Math.exp(-2 * Math.PI * (2500 + tone * 12000) / fs);
    const hpA = 1 - Math.exp(-2 * Math.PI * 120 / fs);
    const twoOverN = 2 / N;
    const wet = mix * 0.7, dry = 1 - mix * 0.3;
    const pre = this.pre, preLen = pre.length;
    let preIdx = this.preIdx;
    const gateOn = gate > 0;
    const holdSamples = (0.02 + gate * 0.38) * fs;
    const envA = 1 - Math.exp(-2 * Math.PI * 30 / fs);
    const closeA = 1 - Math.exp(-2 * Math.PI * 200 / fs);
    let inEnv = this.inEnv, gateEnv = this.gateEnv, gateHold = this.gateHold;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R[i];
      const inMono = (xl + xr) * 0.5;
      const preOut = pre[preIdx]; pre[preIdx] = inMono; if (++preIdx >= preLen) preIdx = 0;
      const x = this.allpass(this.allpass(this.allpass(this.allpass(preOut, 0), 1), 2), 3);
      let sum = 0, outL = 0, outR = 0;
      for (let j = 0; j < N; j++) {
        let ph = modPhase[j] + MOD_RATE[j] / fs; if (ph >= 1) ph -= 1; modPhase[j] = ph;
        const d = lengths[j] + Math.sin(6.283185307 * ph) * MOD_DEPTH;
        const v = readDelay(lines[j], idx[j], d);
        tmp[j] = v; sum += v;
        if (j & 1) outR += (j & 2) ? v : -v; else outL += (j & 2) ? v : -v;
      }
      const s = sum * twoOverN;
      for (let j = 0; j < N; j++) {
        let v = (tmp[j] - s) * gains[j] + ((j & 1) ? -x : x);
        lp[j] += (v - lp[j]) * lpA;
        hp[j] += (lp[j] - hp[j]) * hpA;
        v = lp[j] - hp[j];
        const line = lines[j];
        line[idx[j]] = v;
        if (++idx[j] >= line.length) idx[j] = 0;
      }
      let g = 1;
      if (gateOn) {
        // open while the input is present, hold, then close fast
        const a = inMono < 0 ? -inMono : inMono;
        inEnv += (a - inEnv) * envA;
        if (inEnv > 0.01) { gateHold = holdSamples; gateEnv += (1 - gateEnv) * closeA; }
        else if (gateHold > 0) { gateHold -= 1; gateEnv += (1 - gateEnv) * closeA; }
        else gateEnv += (0 - gateEnv) * closeA;
        g = gateEnv;
      }
      L[i] = xl * dry + outL * wet * g;
      R[i] = xr * dry + outR * wet * g;
    }
    this.preIdx = preIdx; this.inEnv = inEnv; this.gateEnv = gateEnv; this.gateHold = gateHold;
  }
}
