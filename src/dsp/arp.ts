// Arpeggiator counted in frames of the frame clock, like a tracker: one
// step every `div` ticks, gate as a fraction of the step. With `div` 1 it
// is the classic chip arp (chords as 60 Hz note cycling).

import { Rng } from './util.ts';

export interface ArpOut {
  noteOn(note: number, vel: number): void;
  noteOff(note: number): void;
}

interface Key { note: number; vel: number }

export class Arp {
  private keys: Key[] = [];
  private held: Key[] = [];      // what the pattern plays (keys, or latched keys)
  private latched = false;
  private frame = 0;
  private step = 0;
  private dir = 1;
  private sounding = -1;
  private gateLeft = 0;
  private rng = new Rng(4242);
  /** current step for the display */
  get position(): number { return this.step; }

  keyDown(note: number, vel: number, hold: boolean): void {
    if (hold && this.latched && this.keys.length === 0) { this.held = []; this.latched = false; }
    this.keys = this.keys.filter((k) => k.note !== note);
    this.keys.push({ note, vel });
    this.held = this.keys.slice();
  }

  keyUp(note: number, hold: boolean): void {
    this.keys = this.keys.filter((k) => k.note !== note);
    if (hold) { this.latched = true; return; }
    this.held = this.keys.slice();
  }

  /** Called when hold is switched off / sustain released. */
  unlatch(out: ArpOut): void {
    this.latched = false;
    this.held = this.keys.slice();
    if (this.held.length === 0) this.stop(out);
  }

  stop(out: ArpOut): void {
    if (this.sounding >= 0) { out.noteOff(this.sounding); this.sounding = -1; }
    this.keys = []; this.held = []; this.latched = false;
    this.frame = 0; this.step = 0; this.dir = 1;
  }

  /** One frame tick. */
  tick(mode: number, div: number, octaves: number, gate: number, out: ArpOut): void {
    if (mode === 0) return;
    if (this.gateLeft > 0 && --this.gateLeft === 0 && this.sounding >= 0) { out.noteOff(this.sounding); this.sounding = -1; }
    if (this.frame > 0) { this.frame--; return; }
    this.frame = div - 1;
    const held = this.held;
    if (held.length === 0) { if (this.sounding >= 0) { out.noteOff(this.sounding); this.sounding = -1; } return; }
    // build the pattern: sorted (or as played) × octaves
    const base = mode === 5 ? held : held.slice().sort((a, b) => a.note - b.note);
    const len = base.length * octaves;
    let idx: number;
    switch (mode) {
      case 1: idx = this.step % len; this.step = (this.step + 1) % len; break;
      case 2: idx = len - 1 - (this.step % len); this.step = (this.step + 1) % len; break;
      case 3: {
        if (len <= 1) { idx = 0; break; }
        idx = this.step;
        this.step += this.dir;
        if (this.step >= len) { this.step = len - 2; this.dir = -1; } else if (this.step < 0) { this.step = 1; this.dir = 1; }
        idx = Math.max(0, Math.min(len - 1, idx));
        break;
      }
      case 4: idx = (this.rng.next() * len) | 0; this.step = idx; break;
      default: idx = this.step % len; this.step = (this.step + 1) % len; break;
    }
    const k = base[idx % base.length];
    const note = k.note + 12 * Math.floor(idx / base.length);
    if (this.sounding >= 0) out.noteOff(this.sounding);
    if (note <= 127) { out.noteOn(note, k.vel); this.sounding = note; }
    this.gateLeft = Math.max(1, Math.round(gate * div));
    if (this.gateLeft >= div) this.gateLeft = 0;   // full gate: legato into the next step
  }
}
