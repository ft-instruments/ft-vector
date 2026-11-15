// Ensemble chorus: three slowly modulated delay taps per side, the left and
// right sets offset in phase so the copies drift apart and the image widens.
// Placed before the echo, so the tails stay clean. A no-op at mix 0 (the
// delay line still fills, so turning it up never plays stale audio).

import { readDelay } from './util.ts';

const TWO_PI = Math.PI * 2;
const TAPS = 3;
const BASE_S = 0.014;     // centre delay
const DEPTH_S = 0.008;    // modulation depth at depth = 1

export class Chorus {
  private bufL: Float32Array; private bufR: Float32Array;
  private idx = 0;
  private phase = 0;
  private readonly len: number;
  private readonly fs: number;

  constructor(sampleRate: number) {
    this.fs = sampleRate;
    this.len = Math.ceil(sampleRate * 0.04) + 8;
    this.bufL = new Float32Array(this.len); this.bufR = new Float32Array(this.len);
  }

  clear(): void { this.bufL.fill(0); this.bufR.fill(0); }

  /** In place. `rate` in Hz, `depth` 0..1, `mix` 0..1. */
  process(L: Float32Array, R: Float32Array, n: number, rate: number, depth: number, mix: number): void {
    const len = this.len, bl = this.bufL, br = this.bufR;
    const inc = rate / this.fs;
    const base = BASE_S * this.fs, dep = depth * DEPTH_S * this.fs;
    const on = mix > 0;
    let idx = this.idx, ph = this.phase;
    for (let i = 0; i < n; i++) {
      bl[idx] = L[i]; br[idx] = R[i];
      if (on) {
        let wl = 0, wr = 0;
        for (let k = 0; k < TAPS; k++) {
          const t = ph + k / TAPS;
          wl += readDelay(bl, idx, base + dep * Math.sin(TWO_PI * t));
          wr += readDelay(br, idx, base + dep * Math.sin(TWO_PI * (t + 1 / 6)));
        }
        L[i] = L[i] * (1 - mix * 0.5) + (wl / TAPS) * mix * 0.7;
        R[i] = R[i] * (1 - mix * 0.5) + (wr / TAPS) * mix * 0.7;
      }
      ph += inc; if (ph >= 1) ph -= 1;
      if (++idx >= len) idx = 0;
    }
    this.idx = idx; this.phase = ph;
  }
}
