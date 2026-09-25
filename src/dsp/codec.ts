// A small MDCT transform coder, the way a perceptual codec works but with
// nothing to hide its mistakes: the spectrum of each 512-sample block
// (256 new samples) is quantised against a bit budget, the coefficients
// that don't fit are zeroed, and what survives is quantised coarsely. Low
// budgets give the "underwater" MP3 sound — birdies as coefficients flicker
// in and out, pre-echo from the block quantisation spreading over the
// window, and a band limit. Only the mid signal is coded; the side is
// attenuated (low bitrates go mono), which is also what codecs do.

const N = 256;          // coefficients per block; window is 2N
const W = 2 * N;

export class Codec {
  private win = new Float32Array(W);
  private cosT: Float32Array;                 // N × W basis, precomputed
  private inBuf = new Float32Array(W);        // last 2N mid samples
  private inPos = 0;
  private coef = new Float32Array(N);
  private mags = new Float32Array(N);
  private sorted = new Float32Array(N);
  private synth = new Float32Array(W);        // current block's inverse transform
  private overlap = new Float32Array(N);      // tail of the previous block
  private outBuf = new Float32Array(N);       // decoded samples ready to be read
  private outPos = N;
  private delayL: Float32Array; private delayR: Float32Array;   // to align the dry / side path
  private dIdx = 0;
  private readonly fs: number;
  /** coefficients kept in the last block (display) */
  kept = 0;

  constructor(sampleRate: number) {
    this.fs = sampleRate;
    for (let n = 0; n < W; n++) this.win[n] = Math.sin(Math.PI * (n + 0.5) / W);
    this.cosT = new Float32Array(N * W);
    for (let k = 0; k < N; k++)
      for (let n = 0; n < W; n++)
        this.cosT[k * W + n] = Math.cos((Math.PI / N) * (n + 0.5 + N / 2) * (k + 0.5));
    this.delayL = new Float32Array(W); this.delayR = new Float32Array(W);
  }

  clear(): void {
    this.inBuf.fill(0); this.overlap.fill(0); this.outBuf.fill(0); this.delayL.fill(0); this.delayR.fill(0);
    this.inPos = 0; this.outPos = N;
  }

  /** In place. `amount` 0..1 wet mix, `kbps` the bit budget. */
  process(L: Float32Array, R: Float32Array, n: number, amount: number, kbps: number): void {
    if (amount <= 0) return;
    const bits = kbps * 1000 * N / this.fs;                 // bits per block
    const keep = Math.max(2, Math.min(N, Math.round(bits / 7)));   // ~7 bits per surviving coefficient incl. side info
    const cutoff = Math.min(N, Math.round(N * (0.12 + 0.88 * Math.min(1, kbps / 160))));
    const qSteps = Math.max(3, Math.min(256, Math.round(4 + kbps * 2)));
    const side = 1 - amount * (1 - Math.min(1, kbps / 96));
    const dl = this.delayL, dr = this.delayR;
    for (let i = 0; i < n; i++) {
      const mid = (L[i] + R[i]) * 0.5;
      // the dry path is delayed by the codec latency (2N) so the mix lines up
      const dOut = this.dIdx;
      const dryMid = (dl[dOut] + dr[dOut]) * 0.5, drySide = (dl[dOut] - dr[dOut]) * 0.5;
      dl[dOut] = L[i]; dr[dOut] = R[i];
      this.dIdx = (dOut + 1) % W;
      // feed the coder
      this.inBuf[this.inPos] = mid;
      if (++this.inPos >= W) this.inPos = 0;
      if (this.outPos >= N) { this.block(keep, cutoff, qSteps); this.outPos = 0; }
      const wet = this.outBuf[this.outPos++];
      const m = dryMid + (wet - dryMid) * amount;
      const s = drySide * side;
      L[i] = m + s; R[i] = m - s;
    }
  }

  /** Every N samples: transform the last 2N, quantise, inverse, overlap-add. */
  private block(keep: number, cutoff: number, qSteps: number): void {
    const inBuf = this.inBuf, win = this.win, cosT = this.cosT, coef = this.coef, mags = this.mags;
    // gather the windowed frame in time order
    const synth = this.synth;
    let p = this.inPos;
    for (let i = 0; i < W; i++) { synth[i] = inBuf[p] * win[i]; if (++p >= W) p = 0; }
    // forward
    let max = 0;
    for (let k = 0; k < N; k++) {
      let s = 0;
      const row = k * W;
      for (let i = 0; i < W; i++) s += synth[i] * cosT[row + i];
      coef[k] = s;
      const a = s < 0 ? -s : s;
      mags[k] = k < cutoff ? a : 0;
      if (a > max) max = a;
    }
    // bit allocation: keep the `keep` largest, quantise them relative to the block peak
    let thr = 0;
    if (keep < cutoff) {
      const sorted = this.sorted;
      sorted.set(mags);
      sorted.sort();                       // typed-array sort: numeric, in place, no allocation
      thr = sorted[N - keep];
    }
    const step = max > 0 ? max / qSteps : 1, inv = 1 / step;
    let kept = 0;
    // inverse (sparse: most coefficients are zero at low bitrates), window, overlap-add
    synth.fill(0);
    for (let k = 0; k < N; k++) {
      const a = mags[k];
      if (k >= cutoff || a < thr || a === 0) continue;
      const c = Math.round(coef[k] * inv) * step;
      if (c === 0) continue;
      kept++;
      const row = k * W;
      for (let i = 0; i < W; i++) synth[i] += c * cosT[row + i];
    }
    this.kept = kept;
    const scale = 2 / N;
    for (let i = 0; i < W; i++) synth[i] *= scale * win[i];
    const out = this.outBuf, ov = this.overlap;
    for (let i = 0; i < N; i++) { out[i] = ov[i] + synth[i]; ov[i] = synth[N + i]; }
  }
}
