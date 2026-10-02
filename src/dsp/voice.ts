// One voice: the six chip channels playing one note. In chip mode there is
// exactly one; in modern mode up to eight. Levels, pitches and duties are
// computed once per 32-sample chunk (and ramped over it), which is how a
// chip driven by a frame interrupt behaves anyway.

import { ChipOsc, dividerTune, SRC_FM, SRC_NOISE, SRC_PD, SRC_PULSE, SRC_WAVE, type OscParams } from './chip.ts';
import { ADSR, TablePos } from './registers.ts';
import { midiToFreq, Rng } from './util.ts';
import { CHANNELS, CHORD_SEMIS, CLOCK_HZ, DUTY_VALUES, type ParamValues } from './params.ts';

const TYPES = [SRC_PULSE, SRC_PULSE, SRC_WAVE, SRC_NOISE, SRC_FM, SRC_PD];
const PRE = CHANNELS.map((c) => c.pre);

/** What the engine computes per chunk for every voice. */
export interface Mod {
  pitchCt: number;     // registers → pitch, cents
  caSemi: number;      // automaton → pitch, semitones (integer)
  duty: number;        // -1..1 offset applied to pulse width
  level: number;       // 0..1 multiplier
  bend: number;        // semitones
}

export interface Tables {
  wave: Float32Array;   // 32
  tvA: Float32Array;    // 16
  tvB: Float32Array;    // 16
  tp: Float32Array;     // 16, semitones
}

class Channel {
  osc = new ChipOsc();
  env: ADSR;
  gain = 0;            // last chunk's gain, for ramping
  q: OscParams;
  constructor(sampleRate: number, type: number, wave: Float32Array) {
    this.env = new ADSR(sampleRate);
    this.q = { type, ratio: 1, inc: 0, duty: 0.5, wave, noiseShort: false, noiseInc: 0, fmRatio: 2, fmIndex: 0, fmFb: 0, pdShape: 0, pdAmt: 0 };
  }
}

export class Voice {
  note = 60;
  vel = 1;
  released = false;
  age = 0;
  accent = 1;
  /** current pitch when gliding (fractional MIDI note); equals `note` otherwise */
  pitch = 60;
  /** chord arp: which interval of the chord is sounding, and its direction */
  chordSemi = 0;
  private chordStep = 0;
  private chordDir = 1;
  private chordCount = 0;
  volPos = new TablePos();
  pitPos = new TablePos();
  private ch: Channel[] = [];
  private tmp = new Float32Array(64);
  private p1 = new Float32Array(64);       // pulse 1's last chunk, for the xor
  private rng: Rng;
  private readonly fs: number;

  constructor(sampleRate: number, seed: number, tables: Tables) {
    this.fs = sampleRate;
    this.rng = new Rng(seed * 7919 + 17);
    for (let i = 0; i < 6; i++) this.ch.push(new Channel(sampleRate, TYPES[i], tables.wave));
  }

  get active(): boolean {
    for (const c of this.ch) if (c.env.active) return true;
    return false;
  }

  /** The loudest channel envelope, for voice stealing. */
  get level(): number {
    let m = 0;
    for (const c of this.ch) if (c.env.value > m) m = c.env.value;
    return m;
  }

  noteOn(note: number, vel: number, p: ParamValues, retrigger: boolean, glideFrom = NaN): void {
    // with glide, a new note slides from wherever the last one was
    if (p.glide <= 0) this.pitch = note;
    else if (!this.active) this.pitch = Number.isNaN(glideFrom) ? note : glideFrom;
    this.note = note; this.vel = vel; this.released = false; this.age = 0;
    if (!retrigger) return;
    this.volPos.reset(); this.pitPos.reset();
    this.chordStep = 0; this.chordDir = 1; this.chordCount = 0; this.chordSemi = 0;
    for (let i = 0; i < 6; i++) {
      const c = this.ch[i];
      if (p[PRE[i] + 'Level'] <= 0) { c.env.kill(); continue; }
      c.osc.reset(this.rng);
      c.env.gate();
    }
  }

  /** Chip arp: change pitch without retriggering (glides there if glide is on). */
  setNote(note: number, glide: number): void { this.note = note; if (glide <= 0) this.pitch = note; }

  noteOff(): void {
    this.released = true;
    for (const c of this.ch) c.env.release();
  }

  kill(): void {
    for (const c of this.ch) { c.env.kill(); c.gain = 0; }
    this.released = true;
  }

  /** Frame tick: advance the table envelopes, the chord arp and the glide. */
  tick(p: ParamValues, volLoopA: number, volLoopB: number): void {
    // stepped portamento: so many semitones per frame towards the note
    if (p.glide > 0 && this.pitch !== this.note) {
      const d = this.note - this.pitch;
      if (Math.abs(d) <= p.glide) this.pitch = this.note; else this.pitch += d > 0 ? p.glide : -p.glide;
    } else this.pitch = this.note;
    // the 8-bit chord: one interval per `chordSpeed` frames from a single key
    const chord = p.chord | 0;
    if (chord > 0) {
      const semis = CHORD_SEMIS[chord];
      const len = p.chordOct >= 0.5 ? semis.length * 2 : semis.length;
      if (++this.chordCount >= (p.chordSpeed | 0)) {
        this.chordCount = 0;
        const dir = p.chordDir | 0;
        if (dir === 0) this.chordStep = (this.chordStep + 1) % len;
        else if (dir === 1) this.chordStep = (this.chordStep + len - 1) % len;
        else if (len > 1) {
          this.chordStep += this.chordDir;
          if (this.chordStep >= len) { this.chordStep = len - 2; this.chordDir = -1; } else if (this.chordStep < 0) { this.chordStep = 1; this.chordDir = 1; }
        }
      }
      const i = this.chordStep;
      this.chordSemi = semis[i % semis.length] + (i >= semis.length ? 12 : 0);
    } else this.chordSemi = 0;
    const div = p.tabDiv | 0;
    // one position drives both volume tables; loop point depends on which table a channel reads,
    // so keep it simple: table A's loop unless only B is in use
    let usesA = false, usesB = false;
    for (let i = 0; i < 6; i++) { const e = p[PRE[i] + 'Env'] | 0; if (e === 1) usesA = true; else if (e === 2) usesB = true; }
    this.volPos.tick(div, usesA || !usesB ? volLoopA : volLoopB);
    this.pitPos.tick(div, p.tpLoop | 0);
  }

  render(L: Float32Array, R: Float32Array, off: number, n: number, p: ParamValues, mod: Mod, tabs: Tables): void {
    this.age += n;
    const clockHz = CLOCK_HZ[p.clock | 0];
    const ratio = clockHz / this.fs;
    const velGain = 1 - p.vel + p.vel * this.vel;
    const tmp = this.tmp;
    const basePitch = this.pitch + this.chordSemi + mod.bend + mod.pitchCt * 0.01 + mod.caSemi;
    for (let i = 0; i < 6; i++) {
      const c = this.ch[i], pre = PRE[i], q = c.q;
      const lvl = p[pre + 'Level'];
      if (!c.env.active) { c.gain = 0; continue; }
      // envelope: ADSR, or a drawn table gated by a fast ADSR whose release is the channel's
      const envMode = p[pre + 'Env'] | 0;
      let env: number;
      if (envMode === 0) env = c.env.run(n, p[pre + 'Atk'], p[pre + 'Dec'], p[pre + 'Sus'], p[pre + 'Rel']);
      else env = c.env.run(n, 0.001, 0.005, 1, p[pre + 'Rel']) * (envMode === 1 ? tabs.tvA : tabs.tvB)[this.volPos.pos] / 15;
      // pitch
      let pitch = basePitch + p[pre + 'Oct'] * 12 + p[pre + 'Semi'] + p[pre + 'Fine'] * 0.01;
      if (p[pre + 'PTab'] >= 0.5) pitch += tabs.tp[this.pitPos.pos];
      let f = dividerTune(midiToFreq(pitch), p.precision);
      if (f > clockHz * 0.5) f = clockHz * 0.5;
      q.ratio = ratio;
      q.inc = f / clockHz;
      switch (q.type) {
        case SRC_PULSE: {
          const d = p[pre + 'Duty'] | 0;
          let duty = (d < 4 ? DUTY_VALUES[d] : p[pre + 'Width']) + mod.duty * 0.45;
          q.duty = duty < 0.02 ? 0.02 : duty > 0.98 ? 0.98 : duty;
          break;
        }
        case SRC_NOISE: {
          q.noiseShort = p.nzMode < 0.5;
          // the LFSR is clocked at 93× the pitch so short mode plays the note; long mode is hiss
          const r = midiToFreq(pitch) * 93 / clockHz;
          q.noiseInc = r > 1 ? 1 : r;
          break;
        }
        case SRC_FM:
          q.fmRatio = p.fmRatio;
          q.fmIndex = p.fmIndex * 8 * (1 - p.fmEnvAmt + p.fmEnvAmt * env);
          q.fmFb = p.fmFb;
          break;
        case SRC_PD:
          q.pdShape = p.pdShape | 0;
          q.pdAmt = p.pdAmt * (1 - p.pdEnvAmt + p.pdEnvAmt * env);
          break;
        default: break;
      }
      // render, then pan and ramp the gain over the chunk
      const gain = lvl * velGain * env * mod.level * this.accent;
      tmp.fill(0, 0, n);
      c.osc.render(tmp, 0, n, q, 1);
      if (i === 0) this.p1.set(tmp.subarray(0, n));
      else if (i === 1 && p.p2Xor >= 0.5) for (let k = 0; k < n; k++) tmp[k] *= this.p1[k];
      const pan = p[pre + 'Pan'];
      const gl = Math.cos((pan + 1) * 0.25 * Math.PI) * 1.2, gr = Math.sin((pan + 1) * 0.25 * Math.PI) * 1.2;
      let g = c.gain;
      const dg = (gain - g) / n;
      for (let k = 0; k < n; k++) {
        g += dg;
        const s = tmp[k] * g;
        L[off + k] += s * gl;
        R[off + k] += s * gr;
      }
      c.gain = gain;
    }
  }
}
