// The modulation engine: a tiny virtual machine of 8-bit registers ticked
// at the frame clock. Nothing here is continuous — every value changes on
// a tick and holds until the next, which is the sound.

/** An 8-bit register updated every `div` ticks by one of five operations. */
export class Register {
  value = 0;            // 0..255
  private dir = 1;
  private count = 0;
  private lastOp = -1;

  reset(op: number, step: number): void {
    this.lastOp = op;
    this.count = 0; this.dir = 1;
    this.value = op === 2 || op === 4 ? (step & 255) || 1 : 0;   // rotate / lfsr need a non-zero pattern
  }

  tick(op: number, step: number, mask: number, div: number): void {
    if (op !== this.lastOp) this.reset(op, step);
    if (++this.count < div) return;
    this.count = 0;
    let v = this.value;
    switch (op) {
      case 0: // tri: bounce between 0 and 255
        v += this.dir * step;
        if (v >= 255) { v = 255; this.dir = -1; } else if (v <= 0) { v = 0; this.dir = 1; }
        break;
      case 1: // count: wrap
        v = (v + step) & 255;
        break;
      case 2: // rotate the bit pattern (the pattern is `step`)
        v = ((v << 1) | (v >> 7)) & 255;
        break;
      case 3: // add, then xor with the mask
        v = ((v + step) ^ mask) & 255;
        break;
      default: { // 8-bit Galois LFSR
        const lsb = v & 1;
        v >>= 1;
        if (lsb) v ^= 0xb8;
        if (v === 0) v = step & 255 || 1;
      }
    }
    this.value = v;
  }

  /** Masked value as -1..1 (unipolar for masks that hide the top bit — that's fine, it's a register). */
  out(mask: number): number {
    return ((this.value & mask) / 255) * 2 - 1;
  }
}

/** 1-D elementary cellular automaton on 16 cells with wrap-around; one generation every `div` ticks. */
export class Automaton {
  cells = 0x0100;       // 16 bits; a single live cell in the middle
  private count = 0;
  private lastRule = -1;

  reset(): void { this.cells = 0x0100; this.count = 0; }

  tick(rule: number, div: number): void {
    if (rule !== this.lastRule) { this.lastRule = rule; this.reset(); }
    if (++this.count < div) return;
    this.count = 0;
    const c = this.cells;
    let next = 0;
    for (let i = 0; i < 16; i++) {
      const l = (c >> ((i + 1) & 15)) & 1, m = (c >> i) & 1, r = (c >> ((i + 15) & 15)) & 1;
      const idx = (l << 2) | (m << 1) | r;
      if ((rule >> idx) & 1) next |= 1 << i;
    }
    // a dead universe is restarted so the knob always does something
    this.cells = next === 0 ? 0x0100 : next;
  }

  /** Low byte as 0..1. */
  get value(): number { return (this.cells & 255) / 255; }

  /** Live cells in the low byte, 0..8. */
  get count8(): number {
    let c = this.cells & 255, n = 0;
    while (c) { n += c & 1; c >>= 1; }
    return n;
  }
}

/** Tracker-style table position: one step every `div` ticks, looping from `loop` (16 = hold the last step). */
export class TablePos {
  pos = 0;
  private count = 0;

  reset(): void { this.pos = 0; this.count = 0; }

  tick(div: number, loop: number): void {
    if (++this.count < div) return;
    this.count = 0;
    if (this.pos < 15) this.pos++;
    else if (loop < 16) this.pos = loop;
  }
}

/** Digital ADSR: linear attack, exponential decay / release. Retriggers from the current level. */
export class ADSR {
  value = 0;
  stage = 0;         // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
  private readonly fs: number;
  constructor(sampleRate: number) { this.fs = sampleRate; }

  get active(): boolean { return this.stage !== 0; }

  gate(): void { this.stage = 1; }
  release(): void { if (this.stage !== 0) this.stage = 4; }
  kill(): void { this.stage = 0; this.value = 0; }

  /** Advance n samples and return the level at the end of the block (levels are stepped per block, as on a chip). */
  run(n: number, atk: number, dec: number, sus: number, rel: number): number {
    let v = this.value;
    switch (this.stage) {
      case 1:
        v += n / (atk * this.fs);
        if (v >= 1) { v = 1; this.stage = 2; }
        break;
      case 2: {
        const k = Math.exp(-n / (dec * this.fs * 0.25));
        v = sus + (v - sus) * k;
        if (v - sus < 0.001) { v = sus; this.stage = 3; }
        break;
      }
      case 3:
        v = sus;
        break;
      case 4: {
        const k = Math.exp(-n / (rel * this.fs * 0.25));
        v *= k;
        if (v < 0.0005) { v = 0; this.stage = 0; }
        break;
      }
      default:
        v = 0;
    }
    this.value = v;
    return v;
  }
}
