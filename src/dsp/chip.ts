// Sound-chip oscillators, modelled as mechanisms rather than waveforms.
//
// Every source runs at an *internal* sample rate (8 kHz … 96 kHz) with
// naive (non-band-limited) generation, then goes through a zero-order hold
// / box-average resampler to the host rate. Low internal rates fold the
// highs back down the way real chips do; 96 kHz is clean. The pitch of a
// note is what an integer clock divider can reach (`dividerTune`), so the
// tuning is slightly and systematically off, worse up high.

import { Rng } from './util.ts';

export const SRC_PULSE = 0, SRC_WAVE = 1, SRC_NOISE = 2, SRC_FM = 3, SRC_PD = 4;

/** Master clock of the divider, 2A03-style: f = CLOCK / (16 (N + 1)), 11-bit N. */
const DIVIDER_CLOCK = 1789773;
const TWO_PI = Math.PI * 2;

/** The frequency the chip actually produces for a wanted one, blended towards exact by `precision`. */
export function dividerTune(f: number, precision: number): number {
  if (precision >= 1) return f;
  let n = Math.round(DIVIDER_CLOCK / (16 * f) - 1);
  if (n < 8) n = 8; else if (n > 2047) n = 2047;
  const chip = DIVIDER_CLOCK / (16 * (n + 1));
  return chip + (f - chip) * precision;
}

export interface OscParams {
  type: number;
  /** internal sample rate / host sample rate */
  ratio: number;
  /** cycles per internal sample */
  inc: number;
  duty: number;            // pulse
  wave: Float32Array;      // 32 cells, 0..15
  noiseShort: boolean;     // LFSR mode
  noiseInc: number;        // LFSR shifts per internal sample
  fmRatio: number;
  fmIndex: number;         // radians
  fmFb: number;
  pdShape: number;
  pdAmt: number;
}

export class ChipOsc {
  private phase = 0;
  private acc = 0;
  private held = 0;
  private lfsr = 1;
  private lfsrAcc = 0;
  private mPhase = 0;
  private mPrev = 0;

  reset(rng: Rng): void {
    this.phase = rng.next();
    this.mPhase = 0; this.mPrev = 0;
    this.acc = 0; this.held = 0;
    if (this.lfsr === 0) this.lfsr = 1;
  }

  /** Adds n samples into `out` starting at `off`, scaled by `gain`. */
  render(out: Float32Array, off: number, n: number, q: OscParams, gain: number): void {
    const ratio = q.ratio;
    let acc = this.acc, held = this.held;
    for (let i = 0; i < n; i++) {
      acc += ratio;
      if (acc < 1) { out[off + i] += held * gain; continue; }
      let sum = 0, cnt = 0;
      while (acc >= 1) { acc -= 1; held = this.gen(q); sum += held; cnt++; }
      out[off + i] += (sum / cnt) * gain;
    }
    this.acc = acc; this.held = held;
  }

  /** One internal-rate sample. */
  private gen(q: OscParams): number {
    let ph = this.phase + q.inc;
    if (ph >= 1) ph -= 1;
    this.phase = ph;
    switch (q.type) {
      case SRC_PULSE:
        return ph < q.duty ? 1 : -1;
      case SRC_WAVE:
        return q.wave[(ph * 32) | 0] * (2 / 15) - 1;
      case SRC_NOISE: {
        // 15-bit LFSR clocked at its own rate, never faster than the internal clock
        let a = this.lfsrAcc + q.noiseInc;
        if (a >= 1) {
          a -= 1; if (a >= 1) a = 0.999;
          const s = this.lfsr;
          const fb = (s ^ (s >> (q.noiseShort ? 6 : 1))) & 1;
          this.lfsr = (s >> 1) | (fb << 14);
        }
        this.lfsrAcc = a;
        return (this.lfsr & 1) ? 1 : -1;
      }
      case SRC_FM: {
        let mp = this.mPhase + q.inc * q.fmRatio;
        if (mp >= 1) mp -= Math.floor(mp);
        this.mPhase = mp;
        const m = Math.sin(TWO_PI * mp + q.fmFb * 2 * this.mPrev);
        this.mPrev = m;
        return Math.sin(TWO_PI * ph + q.fmIndex * m);
      }
      default:
        return pd(ph, q.pdShape, q.pdAmt);
    }
  }
}

/** Casio-style phase distortion: bend the phase, read a cosine. */
function pd(ph: number, shape: number, amt: number): number {
  switch (shape) {
    case 0: { // saw: the knee moves from 0.5 towards 0
      const d = 0.5 - amt * 0.49;
      const g = ph < d ? ph * (0.5 / d) : 0.5 + (ph - d) * (0.5 / (1 - d));
      return Math.cos(TWO_PI * g);
    }
    case 1: { // square: fast transitions, flat tops
      const k = 1 / (1 - amt * 0.97);
      const g = ph < 0.5 ? Math.min(0.5, ph * k) : 0.5 + Math.min(0.5, (ph - 0.5) * k);
      return Math.cos(TWO_PI * g);
    }
    case 2: { // pulse: one whole cosine cycle squeezed into the start
      const k = 1 / (1 - amt * 0.95);
      return Math.cos(TWO_PI * Math.min(1, ph * k));
    }
    case 3: { // double sine: two cycles, the second squeezed
      const d = 0.5 + amt * 0.45;
      const g = ph < d ? ph / d : 1 + (ph - d) / (1 - d);
      return Math.cos(TWO_PI * g);
    }
    case 4: // resonant saw: a sine at a multiple of the pitch, windowed by the falling saw
      return Math.cos(TWO_PI * ph * (1 + amt * 15)) * (1 - ph);
    default: { // resonant triangle
      const w = 1 - Math.abs(2 * ph - 1);
      return Math.cos(TWO_PI * ph * (1 + amt * 15)) * w;
    }
  }
}
