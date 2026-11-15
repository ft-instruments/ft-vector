// Chamberlin state-variable filter — the textbook digital filter of the
// early digital synths. Run twice per sample so it stays stable up to the
// top of the audio band; the tuning error near Nyquist is left in.

export class SVF {
  private lp = 0; private bp = 0;
  private f = -1; private q = 0;   // last chunk's coefficients (f < 0: not primed yet)
  private readonly fs: number;
  constructor(sampleRate: number) { this.fs = sampleRate; }

  clear(): void { this.lp = this.bp = 0; this.f = -1; }

  /** In place. mode 0 off, 1 lp, 2 bp, 3 hp. */
  process(buf: Float32Array, off: number, n: number, mode: number, cutoff: number, res: number): void {
    if (mode === 0) return;
    let f = 2 * Math.sin(Math.PI * cutoff / (this.fs * 2));
    if (f > 0.99) f = 0.99;
    const qT = 1 - res * 0.985;
    // ramp the coefficients across the chunk so cutoff sweeps don't zipper
    if (this.f < 0) { this.f = f; this.q = qT; }
    let fc = this.f, q = this.q;
    const df = (f - fc) / n, dq = (qT - q) / n;
    let lp = this.lp, bp = this.bp;
    let hp = 0;
    for (let i = off; i < off + n; i++) {
      fc += df; q += dq;
      const x = buf[i];
      for (let k = 0; k < 2; k++) {
        lp += fc * bp;
        hp = x - lp - q * bp;
        bp += fc * hp;
      }
      // keep the state sane if driven hard
      if (bp > 4) bp = 4; else if (bp < -4) bp = -4;
      buf[i] = mode === 1 ? lp : mode === 2 ? bp : hp;
    }
    this.lp = lp; this.bp = bp; this.f = f; this.q = qT;
  }
}
