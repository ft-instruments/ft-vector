// A software echo the way trackers did it: a delay counted in frames of
// the frame clock (so it moves in steps when the clock does), feedback
// in 4-bit volume steps, and the echo path itself quantised to 4 bits —
// the delayed copy is a coarser copy, and the tail decays in steps.

export class Echo {
  private bufL: Float32Array; private bufR: Float32Array;
  private idx = 0;
  private len: number;

  constructor(sampleRate: number) {
    this.len = Math.ceil(sampleRate * 32 / 8) + 64;      // 32 frames at the slowest clock
    this.bufL = new Float32Array(this.len); this.bufR = new Float32Array(this.len);
  }

  clear(): void { this.bufL.fill(0); this.bufR.fill(0); }

  /** In place. `delay` in samples (0 = off), `fb` 0..0.94, `mix` 0..1. */
  process(L: Float32Array, R: Float32Array, n: number, delay: number, fb: number, ping: boolean, mix: number): void {
    if (delay <= 0 || mix <= 0) return;
    const len = this.len;
    let d = Math.round(delay); if (d >= len - 1) d = len - 1; if (d < 1) d = 1;
    const bl = this.bufL, br = this.bufR;
    let idx = this.idx;
    const q = 8, iq = 1 / q;   // 4-bit echo path
    for (let i = 0; i < n; i++) {
      let r = idx - d; if (r < 0) r += len;
      // truncate, don't round: rounding lets a small value feed back to itself forever (a limit cycle)
      const el = Math.trunc(bl[r] * q) * iq, er = Math.trunc(br[r] * q) * iq;
      if (ping) { bl[idx] = L[i] + er * fb; br[idx] = R[i] + el * fb; }
      else { bl[idx] = L[i] + el * fb; br[idx] = R[i] + er * fb; }
      L[i] += el * mix; R[i] += er * mix;
      if (++idx >= len) idx = 0;
    }
    this.idx = idx;
  }
}
