// The link: the signal path from the synth to the listener modelled as a
// digital transmission with real failure modes, each with a physical
// parameter. Everything is transparent at zero.
//
//   clock drift   the DAC clock wanders: variable-rate resampling
//   clock jitter  timing noise on the sample clock: phase modulation of the resampler
//   packet loss   frames dropped at a rate, hidden by a concealment strategy
//   word length   requantisation to N bits with none / TPDF / noise-shaped dither
//   bit errors    random bit flips in the 16-bit words at a bit-error rate
//   speaker       the tiny speaker of a handheld / TV / terminal

import { readDelay, Rng, tanhf } from './util.ts';

const SQUELCH = 1 / 32768;   // one 16-bit LSB
const CONCEAL_MUTE = 0, CONCEAL_REPEAT = 1, CONCEAL_SMEAR = 2, CONCEAL_CONTINUE = 3;

export class Link {
  private readonly fs: number;
  private rng = new Rng(0x5eed);
  // drift: a wandering read pointer
  private dbufL: Float32Array; private dbufR: Float32Array;
  private dWrite = 0; private dRead = 0; private wander = 0; private rate = 1;
  // jitter: a short modulated delay
  private jbufL = new Float32Array(128); private jbufR = new Float32Array(128);
  private jIdx = 0; private jNoise = 0;
  // packet loss
  private lastL: Float32Array; private lastR: Float32Array;
  private pktLen = 0; private pktPos = 0; private lost = false; private lostRun = 0;
  private lostFade = 0; private smearL = 0; private smearR = 0;
  private periodLen = 0;
  // dither / noise shaping
  private errL = 0; private errR = 0;
  // speaker
  private spk = new Float32Array(16);
  /** true while a packet is being concealed (for the display) */
  losing = false;

  constructor(sampleRate: number) {
    this.fs = sampleRate;
    this.dbufL = new Float32Array(8192); this.dbufR = new Float32Array(8192);
    this.dRead = 8192 - 2048;
    const maxPkt = Math.ceil(0.02 * sampleRate) + 8;
    this.lastL = new Float32Array(maxPkt); this.lastR = new Float32Array(maxPkt);
  }

  clear(): void {
    this.dbufL.fill(0); this.dbufR.fill(0); this.jbufL.fill(0); this.jbufR.fill(0);
    this.lastL.fill(0); this.lastR.fill(0);
    this.errL = this.errR = 0; this.spk.fill(0); this.smearL = this.smearR = 0;
  }

  /** The transmitter's clock: drift and jitter. */
  clock(L: Float32Array, R: Float32Array, n: number, drift: number, jitter: number): void {
    if (drift > 0) this.drift(L, R, n, drift);
    if (jitter > 0) this.jitter(L, R, n, jitter);
  }

  /** The receiver: packet loss, word length, bit errors. */
  receive(L: Float32Array, R: Float32Array, n: number, loss: number, frameMs: number, conceal: number, bits: number, dither: number, ber: number): void {
    if (loss > 0) this.packets(L, R, n, loss, frameMs, conceal); else this.losing = false;
    if (bits < 16) this.words(L, R, n, bits, dither);
    if (ber > 0) this.bitErrors(L, R, n, ber);
  }

  // ---- clock drift: read the buffer at a rate that wanders around 1
  private drift(L: Float32Array, R: Float32Array, n: number, amount: number): void {
    const bl = this.dbufL, br = this.dbufR, len = bl.length;
    // a slow AR(1) walk, plus a restoring force so the read pointer never runs away
    this.wander += this.rng.bi() * 0.08 - this.wander * 0.02;
    if (this.wander > 1) this.wander = 1; else if (this.wander < -1) this.wander = -1;
    let gap = this.dWrite - this.dRead; if (gap < 0) gap += len;
    const err = (gap - 2048) / 1024;
    const target = 1 + amount * 0.012 * this.wander - err * 0.004 * amount;
    let read = this.dRead;
    for (let i = 0; i < n; i++) {
      bl[this.dWrite] = L[i]; br[this.dWrite] = R[i];
      this.dWrite = (this.dWrite + 1) % len;
      this.rate += (target - this.rate) * 0.001;
      const i0 = read | 0, frac = read - i0, i1 = (i0 + 1) % len;
      L[i] = bl[i0] + (bl[i1] - bl[i0]) * frac;
      R[i] = br[i0] + (br[i1] - br[i0]) * frac;
      read += this.rate; if (read >= len) read -= len;
    }
    this.dRead = read;
  }

  // ---- clock jitter: low-passed noise modulates a fractional delay
  private jitter(L: Float32Array, R: Float32Array, n: number, amount: number): void {
    const depth = amount * amount * 28;
    const a = 1 - Math.exp(-2 * Math.PI * 1500 / this.fs);
    let idx = this.jIdx, nz = this.jNoise;
    const bl = this.jbufL, br = this.jbufR;
    for (let i = 0; i < n; i++) {
      bl[idx] = L[i]; br[idx] = R[i];
      nz += (this.rng.bi() - nz) * a;
      const d = 34 + nz * depth;
      L[i] = readDelay(bl, idx, d);
      R[i] = readDelay(br, idx, d);
      idx = (idx + 1) & 127;
    }
    this.jIdx = idx; this.jNoise = nz;
  }

  // ---- packet loss with concealment
  private packets(L: Float32Array, R: Float32Array, n: number, loss: number, frameMs: number, conceal: number): void {
    const wanted = Math.max(8, Math.round(frameMs * 1e-3 * this.fs));
    if (wanted !== this.pktLen) { this.pktLen = wanted; this.pktPos = 0; }
    const len = this.pktLen, lastL = this.lastL, lastR = this.lastR;
    for (let i = 0; i < n; i++) {
      if (this.pktPos === 0) {
        // a new packet: does it arrive?
        const was = this.lost;
        this.lost = this.rng.next() < loss * loss * 0.9 + loss * 0.1;
        this.lostRun = this.lost ? (was ? this.lostRun + 1 : 1) : 0;
        if (this.lost && !was && conceal === CONCEAL_CONTINUE) this.periodLen = this.findPeriod(lastL, len);
        this.losing = this.lost;
      }
      const pos = this.pktPos;
      if (!this.lost) {
        lastL[pos] = L[i]; lastR[pos] = R[i];
        // short fade back in after a hole
        if (this.lostFade > 0) { const g = 1 - this.lostFade / 16; L[i] *= g; R[i] *= g; this.lostFade--; }
      } else {
        switch (conceal) {
          case CONCEAL_MUTE:
            L[i] = 0; R[i] = 0; this.lostFade = 16;
            break;
          case CONCEAL_REPEAT:
            L[i] = lastL[pos]; R[i] = lastR[pos];
            break;
          case CONCEAL_SMEAR: {
            // repeat the last packet through a darkening, fading one-pole
            const k = Math.pow(0.55, this.lostRun);
            this.smearL += (lastL[pos] - this.smearL) * 0.25;
            this.smearR += (lastR[pos] - this.smearR) * 0.25;
            L[i] = this.smearL * k; R[i] = this.smearR * k;
            break;
          }
          default: {
            // continue the last period of the last good packet, fading slowly
            const pl = this.periodLen;
            const j = len - pl + ((pos + (this.lostRun - 1) * len) % pl);
            const k = Math.pow(0.8, this.lostRun - 1);
            L[i] = lastL[j] * k; R[i] = lastR[j] * k;
          }
        }
      }
      if (++this.pktPos >= len) this.pktPos = 0;
    }
  }

  /** Length of the last period in a buffer, by rising zero crossings (falls back to the whole packet). */
  private findPeriod(buf: Float32Array, len: number): number {
    let last = -1;
    for (let i = len - 1; i > 0; i--) {
      if (buf[i - 1] < 0 && buf[i] >= 0) {
        if (last < 0) last = i;
        else if (last - i >= 16) return last - i;
      }
    }
    return len;
  }

  // ---- word length with dither
  private words(L: Float32Array, R: Float32Array, n: number, bits: number, dither: number): void {
    const q = Math.pow(2, bits - 1), iq = 1 / q;
    let eL = this.errL, eR = this.errR;
    for (let i = 0; i < n; i++) {
      let l = L[i], r = R[i];
      // squelch: a silent word stays silent (no dither hiss between notes)
      if (l < SQUELCH && l > -SQUELCH && r < SQUELCH && r > -SQUELCH) { L[i] = 0; R[i] = 0; eL = eR = 0; continue; }
      if (dither === 1) { l += (this.rng.next() + this.rng.next() - 1) * iq; r += (this.rng.next() + this.rng.next() - 1) * iq; }
      else if (dither === 2) { l -= eL; r -= eR; }
      const ql = Math.round(l * q) * iq, qr = Math.round(r * q) * iq;
      if (dither === 2) { eL = ql - l; eR = qr - r; }
      L[i] = ql; R[i] = qr;
    }
    this.errL = eL; this.errR = eR;
  }

  // ---- bit errors in the 16-bit words
  private bitErrors(L: Float32Array, R: Float32Array, n: number, ber: number): void {
    const p = ber * ber * ber * 0.06;
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i];
      if (l < SQUELCH && l > -SQUELCH && r < SQUELCH && r > -SQUELCH) continue;   // nothing on the line
      if (this.rng.next() < p) {
        const bit = (this.rng.next() * 16) | 0;
        let w = Math.round(Math.max(-1, Math.min(1, L[i])) * 32767) & 0xffff;
        w ^= 1 << bit;
        L[i] = ((w << 16) >> 16) / 32767;
      }
      if (this.rng.next() < p) {
        const bit = (this.rng.next() * 16) | 0;
        let w = Math.round(Math.max(-1, Math.min(1, R[i])) * 32767) & 0xffff;
        w ^= 1 << bit;
        R[i] = ((w << 16) >> 16) / 32767;
      }
    }
  }

  // ---- tiny speaker: mono, band-passed, a resonance around 1.4 kHz, a little overdrive
  speaker(L: Float32Array, R: Float32Array, n: number, amount: number): void {
    const s = this.spk;
    const fs = this.fs;
    const hpA = 1 - Math.exp(-2 * Math.PI * 260 / fs);
    const lpA = 1 - Math.exp(-2 * Math.PI * 3600 / fs);
    // resonant peak: a 2-pole band-pass mixed in
    const w = 2 * Math.PI * 1400 / fs, r = 0.985;
    const b0 = (1 - r) * 2, a1 = -2 * r * Math.cos(w), a2 = r * r;
    for (let i = 0; i < n; i++) {
      const x = (L[i] + R[i]) * 0.5;
      // two one-pole high-passes
      s[0] += (x - s[0]) * hpA; let y = x - s[0];
      s[1] += (y - s[1]) * hpA; y -= s[1];
      // two one-pole low-passes
      s[2] += (y - s[2]) * lpA; s[3] += (s[2] - s[3]) * lpA; y = s[3];
      // resonance
      const bp = b0 * y - a1 * s[4] - a2 * s[5];
      s[5] = s[4]; s[4] = bp;
      y = tanhf((y + bp * 0.6) * 1.6) * 0.8;
      L[i] += (y - L[i]) * amount;
      R[i] += (y - R[i]) * amount;
    }
  }
}
