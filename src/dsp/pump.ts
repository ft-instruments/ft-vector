// The pump: a sidechain-style ducker, but the "kick" is the frame clock.
// Every Nth frame the level snaps down (a few ms) and recovers
// exponentially, so a held pad breathes in time with the machine.

const ATTACK_S = 0.004;

export class Pump {
  private e = 0;                 // duck envelope, 0 = none, 1 = full
  private attacking = false;
  private readonly fs: number;

  constructor(sampleRate: number) { this.fs = sampleRate; }

  clear(): void { this.e = 0; this.attacking = false; }

  /** A frame that should hit. */
  trigger(): void { this.attacking = true; }

  /** In place over [off, off + n). `amt` 0..1 depth, `rel` seconds to recover. */
  process(L: Float32Array, R: Float32Array, off: number, n: number, amt: number, rel: number): void {
    if (amt <= 0) { this.e = 0; this.attacking = false; return; }
    const atk = 1 / (ATTACK_S * this.fs);
    const dec = Math.exp(-3 / (rel * this.fs));
    let e = this.e, a = this.attacking;
    for (let i = off; i < off + n; i++) {
      if (a) { e += atk; if (e >= 1) { e = 1; a = false; } }
      else { e *= dec; if (e < 1e-9) e = 0; }
      const g = 1 - amt * e;
      L[i] *= g; R[i] *= g;
    }
    this.e = e; this.attacking = a;
  }
}
