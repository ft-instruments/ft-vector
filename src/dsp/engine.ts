// The whole instrument: MIDI in, stereo audio out. The frame clock ticks
// the registers, the automaton, the arp, the table envelopes and the chip
// note cycling; the voices render between ticks; then the mix goes
// through the filter and out over the link.
//
//   voices → SVF → clock (drift, jitter) → codec → receive (loss, words,
//   bit errors) → plate → speaker → volume → DC block → clip
//
// Shaped like a plugin processor: construct with a sample rate, feed
// noteOn/noteOff/controlChange/pitchBend, call process(L, R, n).

import { Voice, type Mod, type Tables } from './voice.ts';
import { Register, Automaton } from './registers.ts';
import { Arp } from './arp.ts';
import { SVF } from './svf.ts';
import { Link } from './link.ts';
import { Codec } from './codec.ts';
import { Plate } from './reverb.ts';
import { Echo } from './echo.ts';
import { Chorus } from './chorus.ts';
import { Pump } from './pump.ts';
import { CHUNK, DCBlock, softClip } from './util.ts';
import { defaults, PARAM_BY_ID, type ParamId, type ParamValues } from './params.ts';

const MAX_VOICES = 8;
const TICKS_PER_BEAT = 24;

export class VectorEngine {
  readonly p: ParamValues = defaults();
  readonly tables: Tables = { wave: new Float32Array(32), tvA: new Float32Array(16), tvB: new Float32Array(16), tp: new Float32Array(16) };
  private voices: Voice[] = [];
  private r1 = new Register();
  private r2 = new Register();
  private ca = new Automaton();
  private arp = new Arp();
  private svfL: SVF; private svfR: SVF;
  private link: Link;
  private codec: Codec;
  private plate: Plate;
  private echo: Echo;
  private chorus: Chorus;
  private pump: Pump;
  private dcL: DCBlock; private dcR: DCBlock;
  private mod: Mod = { pitchCt: 0, caSemi: 0, duty: 0, level: 1, bend: 0 };
  private cutMul = 1;
  private bendNorm = 0;
  private sustain = false;
  private sustained = new Set<Voice>();
  private held: number[] = [];          // chip mode: keys down, in order
  private cycleIdx = 0;
  private lastNote = NaN;
  private frameAcc = 0;
  private tickCount = 0;
  private readonly fs: number;
  /** Notes started by the arp, for the UI (optional). */
  onNote: ((note: number, velocity: number) => void) | null = null;
  private arpOut = {
    noteOn: (n: number, v: number) => { this.voiceOn(n, v); this.onNote?.(n, v); },
    noteOff: (n: number) => this.voiceOff(n),
  };

  /** Peak level of the last block (for meters). */
  peakL = 0; peakR = 0;
  /** Recent output for the vector scope; ring buffers. */
  readonly scopeL = new Float32Array(512);
  readonly scopeR = new Float32Array(512);
  private scopeIdx = 0;
  /** Live machine state for the display: r1, r2, ca lo, ca hi, vol pos, pitch pos, arp step, tick, losing, codec kept, voices. */
  readonly display = new Uint8Array(16);

  constructor(sampleRate: number) {
    this.fs = sampleRate;
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(sampleRate, i + 1, this.tables));
    this.svfL = new SVF(sampleRate); this.svfR = new SVF(sampleRate);
    this.link = new Link(sampleRate);
    this.codec = new Codec(sampleRate);
    this.plate = new Plate(sampleRate);
    this.echo = new Echo(sampleRate);
    this.chorus = new Chorus(sampleRate);
    this.pump = new Pump(sampleRate);
    this.dcL = new DCBlock(sampleRate); this.dcR = new DCBlock(sampleRate);
    for (const id in this.p) this.syncTable(id, this.p[id]);
  }

  get activeVoices(): number {
    let c = 0;
    for (const v of this.voices) if (v.active) c++;
    return c;
  }

  get chip(): boolean { return this.p.mode < 0.5; }
  get arpOn(): boolean { return this.p.arpMode >= 1; }

  // ---------------------------------------------------------------- params

  setParam(id: ParamId, value: number): void {
    const def = PARAM_BY_ID[id];
    if (!def) return;
    const v = Math.min(def.max, Math.max(def.min, value));
    if (id === 'arpMode' && v < 1 && this.p.arpMode >= 1) this.arp.stop(this.arpOut);
    if (id === 'mode' && v !== this.p.mode) this.allNotesOff();
    this.p[id] = v;
    if (def.tab) this.syncTable(id, v);
  }

  private syncTable(id: ParamId, v: number): void {
    const def = PARAM_BY_ID[id];
    if (!def?.tab) return;
    const t = def.tab === 'wv' ? this.tables.wave : def.tab === 'tvA' ? this.tables.tvA : def.tab === 'tvB' ? this.tables.tvB : this.tables.tp;
    t[def.idx!] = v;
  }

  setParams(values: Partial<ParamValues>): void {
    for (const id in values) this.setParam(id, values[id]!);
  }

  /** Replace every parameter (preset load). Missing ids go to their default. */
  loadPreset(values: Partial<ParamValues>): void {
    const d = defaults();
    for (const id in d) this.setParam(id, values[id] ?? d[id]);
  }

  // ------------------------------------------------------------------ MIDI

  noteOn(note: number, velocity: number): void {
    if (velocity <= 0) { this.noteOff(note); return; }
    const vel = Math.min(1, velocity / 127);
    if (this.arpOn) this.arp.keyDown(note, vel, this.p.arpHold >= 0.5 || this.sustain);
    else this.voiceOn(note, vel);
  }

  noteOff(note: number): void {
    if (this.arpOn) this.arp.keyUp(note, this.p.arpHold >= 0.5 || this.sustain);
    else this.voiceOff(note);
  }

  controlChange(cc: number, value: number): void {
    switch (cc) {
      case 64: {
        const on = value >= 64;
        if (on === this.sustain) break;
        this.sustain = on;
        if (!on) {
          for (const v of this.sustained) if (v.active && !v.released) v.noteOff();
          this.sustained.clear();
          if (this.arpOn && this.p.arpHold < 0.5) this.arp.unlatch(this.arpOut);
        }
        break;
      }
      case 120: case 123: this.allNotesOff(); break;
      default: break;
    }
  }

  /** -1..1 */
  pitchBend(v: number): void { this.bendNorm = Math.max(-1, Math.min(1, v)); }

  allNotesOff(): void {
    this.arp.stop(this.arpOut);
    for (const v of this.voices) if (v.active && !v.released) v.noteOff();
    this.sustained.clear();
    this.held = [];
  }

  panic(): void {
    this.allNotesOff();
    for (const v of this.voices) v.kill();
    this.svfL.clear(); this.svfR.clear();
    this.link.clear(); this.codec.clear(); this.plate.clear(); this.echo.clear(); this.chorus.clear(); this.pump.clear();
  }

  // --------------------------------------------------------- allocation

  private voiceOn(note: number, vel: number): void {
    const p = this.p;
    if (this.chip) {
      // one voice; more keys = the chip arp cycles them at frame rate
      const v = this.voices[0];
      const idx = this.held.indexOf(note);
      if (idx >= 0) this.held.splice(idx, 1);
      this.held.push(note);
      this.cycleIdx = this.held.length - 1;
      if (!v.active || v.released || this.held.length === 1) v.noteOn(note, vel, p, true);
      else v.setNote(note, p.glide);
      this.sustained.delete(v);
    } else {
      const v = this.allocate(note);
      v.noteOn(note, vel, p, true, this.lastNote);
      this.sustained.delete(v);
    }
    this.lastNote = note;
  }

  private voiceOff(note: number): void {
    if (this.chip) {
      const idx = this.held.indexOf(note);
      if (idx >= 0) this.held.splice(idx, 1);
      const v = this.voices[0];
      if (!v.active || v.released) return;
      if (this.held.length > 0) {
        if (v.note === note) { this.cycleIdx = this.held.length - 1; v.setNote(this.held[this.cycleIdx], this.p.glide); }
      } else if (this.sustain) this.sustained.add(v);
      else v.noteOff();
    } else {
      for (const v of this.voices) {
        if (v.note !== note || !v.active || v.released) continue;
        if (this.sustain) this.sustained.add(v); else v.noteOff();
      }
    }
  }

  private allocate(note: number): Voice {
    for (const v of this.voices) if (v.active && v.note === note && !v.released) return v;
    for (const v of this.voices) if (!v.active) return v;
    // steal: quietest released voice, else the oldest
    let best: Voice | null = null, bestScore = Infinity;
    for (const v of this.voices) {
      const score = v.released ? v.level : 10 - v.age * 1e-6;
      if (score < bestScore) { bestScore = score; best = v; }
    }
    return best ?? this.voices[0];
  }

  // ------------------------------------------------------------ the frame

  private tick(): void {
    const p = this.p;
    this.tickCount++;
    if (p.pumpAmt > 0 && (this.tickCount - 1) % (p.pumpDiv | 0) === 0) this.pump.trigger();
    this.r1.tick(p.r1Op | 0, p.r1Step | 0, p.r1Mask | 0, p.r1Div | 0);
    this.r2.tick(p.r2Op | 0, p.r2Step | 0, p.r2Mask | 0, p.r2Div | 0);
    this.ca.tick(p.caRule | 0, p.caDiv | 0);
    this.arp.tick(p.arpMode | 0, p.arpDiv | 0, p.arpOct | 0, p.arpGate, this.arpOut);
    const loopA = p.tvALoop | 0, loopB = p.tvBLoop | 0;
    for (const v of this.voices) if (v.active) v.tick(p, loopA, loopB);
    if (this.chip) {
      // the chip arp: cycle the held keys, one per frame
      const v = this.voices[0];
      if (this.held.length > 1 && v.active && !v.released) {
        this.cycleIdx = (this.cycleIdx + 1) % this.held.length;
        v.setNote(this.held[this.cycleIdx], p.glide);
      }
    } else if (p.cycle > 0) {
      // modern: the same cycling survives as a round-robin accent between the voices
      let n = 0;
      for (const v of this.voices) if (v.active) n++;
      if (n > 1) {
        const pick = this.tickCount % n;
        let i = 0;
        for (const v of this.voices) {
          if (!v.active) continue;
          v.accent = i === pick ? 1 : 1 - p.cycle * 0.5;
          i++;
        }
      } else for (const v of this.voices) v.accent = 1;
    }
    // modulation for the next frame
    const r1 = this.r1.out(p.r1Mask | 0), r2 = this.r2.out(p.r2Mask | 0);
    const caV = this.ca.value, caB = caV * 2 - 1;
    const m = this.mod;
    m.pitchCt = r1 * p.r1Pitch + r2 * p.r2Pitch;
    m.caSemi = Math.round((this.ca.count8 / 8) * p.caPitch);
    m.duty = r1 * p.r1Duty + r2 * p.r2Duty + caB * p.caDuty;
    m.level = (1 - p.r1Level * (0.5 - r1 * 0.5)) * (1 - p.r2Level * (0.5 - r2 * 0.5)) * (1 - p.caLevel * (1 - caV));
    this.cutMul = Math.pow(2, (r1 * p.r1Cut + r2 * p.r2Cut + caB * p.caCut) * 3);
    // display
    const d = this.display;
    d[0] = this.r1.value; d[1] = this.r2.value;
    d[2] = this.ca.cells & 255; d[3] = (this.ca.cells >> 8) & 255;
    d[4] = this.voices[0].volPos.pos; d[5] = this.voices[0].pitPos.pos;
    d[6] = this.arp.position & 255; d[7] = this.tickCount & 255;
  }

  // ---------------------------------------------------------------- audio

  process(L: Float32Array, R: Float32Array, n: number): void {
    const p = this.p;
    L.fill(0, 0, n); R.fill(0, 0, n);
    const frameHz = p.frameSync >= 0.5 ? (p.tempo / 60) * TICKS_PER_BEAT : p.frameHz;
    const framePeriod = this.fs / frameHz;
    this.mod.bend = this.bendNorm * p.bend;
    for (let off = 0; off < n; off += CHUNK) {
      const count = Math.min(CHUNK, n - off);
      this.frameAcc -= count;
      while (this.frameAcc <= 0) { this.tick(); this.frameAcc += framePeriod; }
      for (const v of this.voices) if (v.active) v.render(L, R, off, count, p, this.mod, this.tables);
      if (p.fMode >= 1) {
        let cut = p.cutoff * this.cutMul;
        if (cut < 20) cut = 20; else if (cut > 20000) cut = 20000;
        this.svfL.process(L, off, count, p.fMode | 0, cut, p.res);
        this.svfR.process(R, off, count, p.fMode | 0, cut, p.res);
      }
      this.pump.process(L, R, off, count, p.pumpAmt, p.pumpRel);
    }
    const trim = 0.4;
    for (let i = 0; i < n; i++) { L[i] *= trim; R[i] *= trim; }
    this.chorus.process(L, R, n, p.chRate, p.chDepth, p.chMix);
    this.echo.process(L, R, n, (p.echoFrames | 0) * framePeriod, (p.echoFb | 0) / 16, p.echoPing >= 0.5, p.echoMix);
    // the link
    this.link.clock(L, R, n, p.lkDrift, p.lkJitter);
    this.codec.process(L, R, n, p.lkCodec, p.lkKbps);
    this.link.receive(L, R, n, p.lkLoss, p.lkFrame, p.lkConceal | 0, p.lkBits | 0, p.lkDither | 0, p.lkBer);
    this.plate.process(L, R, n, p.rvSize, p.rvDecay, p.rvTone, p.rvGate, p.rvMix);
    if (p.lkSpeaker > 0) this.link.speaker(L, R, n, p.lkSpeaker);
    // stereo width: scale the side signal
    if (p.width !== 1) {
      const w = p.width;
      for (let i = 0; i < n; i++) {
        const m = (L[i] + R[i]) * 0.5, s = (L[i] - R[i]) * 0.5 * w;
        L[i] = m + s; R[i] = m - s;
      }
    }
    // volume, DC, safety clip, meters, scope
    const vol = p.volume * p.volume * 1.6;
    let pl = 0, pr = 0;
    const sL = this.scopeL, sR = this.scopeR; let si = this.scopeIdx;
    for (let i = 0; i < n; i++) {
      const l = softClip(this.dcL.tick(L[i] * vol));
      const r = softClip(this.dcR.tick(R[i] * vol));
      L[i] = l; R[i] = r;
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
      if (al > pl) pl = al; if (ar > pr) pr = ar;
      sL[si] = l; sR[si] = r; si = (si + 1) & 511;
    }
    this.scopeIdx = si;
    this.peakL = pl; this.peakR = pr;
    const d = this.display;
    d[8] = this.link.losing ? 1 : 0; d[9] = Math.min(255, this.codec.kept); d[10] = this.activeVoices;
  }
}
