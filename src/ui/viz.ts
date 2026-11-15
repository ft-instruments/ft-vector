// The picture in each module: what the controls are doing, drawn from the
// parameters with the same maths the chip uses (duty cycles, the drawn
// wavetable, the LFSR, 2-op FM, Casio phase distortion, the Chamberlin SVF,
// the 4-bit frame echo, the gated plate, the link's failures). Redrawn when
// a value changes, never per audio block. The drawing helper and the Viz
// canvas are the family's (same as Mycelia's); the pictures are Vector's.

import { type ParamValues, CHORD_SEMIS, CLOCK_HZ, DUTY_VALUES, CLOCKS } from '../dsp/params.ts';

type Draw = (g: Pen, v: ParamValues) => void;

/** A canvas drawing helper with the module's accent and a glow. */
class Pen {
  /** the caption (drawn by Viz in a band under the graph, never over it) */
  cap = '';
  constructor(public ctx: CanvasRenderingContext2D, public w: number, public h: number, public rgb: string) {}
  c(a: number): string { return `rgba(${this.rgb}, ${a})`; }

  grid(cols: number, rows = 2): void {
    const { ctx, w, h } = this;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)'; ctx.lineWidth = 1;
    ctx.setLineDash([1, 3]);
    ctx.beginPath();
    for (let i = 1; i < cols; i++) { const x = Math.round((i / cols) * w) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let j = 1; j < rows; j++) { const y = Math.round((j / rows) * h) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** A glowing line through the points, with a fading fill down to `base`. */
  trace(pts: [number, number][], opts: { base?: number; alpha?: number; width?: number; fill?: boolean; dash?: number[] } = {}): void {
    if (pts.length < 2) return;
    const { ctx } = this;
    const alpha = opts.alpha ?? 1;
    if (opts.fill !== false && opts.base !== undefined) {
      const grad = ctx.createLinearGradient(0, 0, 0, this.h);
      grad.addColorStop(0, this.c(0.3 * alpha));
      grad.addColorStop(1, this.c(0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], opts.base);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], opts.base);
      ctx.closePath(); ctx.fill();
    }
    ctx.setLineDash(opts.dash ?? []);
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.shadowColor = this.c(0.95 * alpha); ctx.shadowBlur = 8;
    ctx.strokeStyle = this.c(alpha); ctx.lineWidth = opts.width ?? 1.7;
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.setLineDash([]);
  }

  dot(x: number, y: number, r = 3, a = 1): void {
    const { ctx } = this;
    ctx.shadowColor = this.c(1); ctx.shadowBlur = 10;
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.shadowBlur = 0;
  }

  bar(x: number, y: number, w: number, h: number, a = 1): void {
    const { ctx } = this;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, this.c(0.95 * a));
    grad.addColorStop(1, this.c(0.2 * a));
    ctx.shadowColor = this.c(0.8 * a); ctx.shadowBlur = 8;
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, Math.max(1, h));
    ctx.shadowBlur = 0;
  }

  /** The usual call (top right, y = 13) sets the caption; anything else is drawn where it is asked for, as a message inside the graph. */
  text(s: string, x: number, y: number, align: CanvasTextAlign = 'left', a = 0.78): void {
    if (y === 13) { this.cap = s; return; }
    const { ctx } = this;
    ctx.font = '500 10.5px "Geist Mono", "FT Symbols", ui-monospace, monospace';
    ctx.textAlign = align; ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.fillText(s.toUpperCase(), x, y);
  }

  /** A periodic function drawn over `cycles` periods, stepped into `steps` samples per period. */
  wave(f: (ph: number) => number, cycles: number, steps: number, amp: number, alpha = 1): void {
    const { w, h } = this;
    const mid = h / 2, pts: [number, number][] = [];
    const n = Math.max(2, Math.round(steps * cycles));
    for (let i = 0; i < n; i++) {
      const ph = ((i / n) * cycles) % 1;
      const y = mid - f(ph) * amp;
      pts.push([(i / n) * w, y], [((i + 1) / n) * w, y]);      // held, like the chip's zero-order hold
    }
    this.trace(pts, { base: mid, alpha });
  }
}

// ---- the chip's maths, for drawing -------------------------------------------------

/** Casio-style phase distortion (chip.ts). */
function pd(ph: number, shape: number, amt: number): number {
  const T = Math.PI * 2;
  switch (shape) {
    case 0: { const d = 0.5 - amt * 0.49; const g = ph < d ? ph * (0.5 / d) : 0.5 + (ph - d) * (0.5 / (1 - d)); return Math.cos(T * g); }
    case 1: { const k = 1 / (1 - amt * 0.97); const g = ph < 0.5 ? Math.min(0.5, ph * k) : 0.5 + Math.min(0.5, (ph - 0.5) * k); return Math.cos(T * g); }
    case 2: { const k = 1 / (1 - amt * 0.95); return Math.cos(T * Math.min(1, ph * k)); }
    case 3: { const d = 0.5 + amt * 0.45; const g = ph < d ? ph / d : 1 + (ph - d) / (1 - d); return Math.cos(T * g); }
    case 4: return Math.cos(T * ph * (1 + amt * 15)) * (1 - ph);
    default: { const w = 1 - Math.abs(2 * ph - 1); return Math.cos(T * ph * (1 + amt * 15)) * w; }
  }
}

const dutyOf = (v: ParamValues, pre: string) => {
  const d = Math.round(v[`${pre}Duty`]);
  return d < 4 ? DUTY_VALUES[d] : v[`${pre}Width`];
};

const levelAlpha = (lvl: number) => (lvl > 0 ? 1 : 0.3);

// ---- the pictures ----------------------------------------------------------------

const pulse = (pre: 'p1' | 'p2'): Draw => (g, v) => {
  g.grid(4);
  const duty = dutyOf(v, pre), amp = g.h / 2 - 10;
  const xor = pre === 'p2' && v.p2Xor >= 0.5;
  if (xor) {
    // pulse 2 times pulse 1: for ±1 squares that is an XOR — draw pulse 1 faint underneath
    const d1 = dutyOf(v, 'p1');
    g.wave((ph) => (ph < d1 ? 1 : -1), 3, 64, amp * 0.9, 0.25);
    g.wave((ph) => ((ph < duty ? 1 : -1) * (((ph * 1.0) % 1) < d1 ? 1 : -1)), 3, 64, amp, levelAlpha(v[`${pre}Level`]));
  } else {
    g.wave((ph) => (ph < duty ? 1 : -1), 3, 64, amp, levelAlpha(v[`${pre}Level`]));
  }
  g.text(`${(duty * 100).toFixed(duty < 0.2 ? 1 : 0)}% duty${xor ? ' · xor' : ''}`, g.w - 8, 13, 'right');
};

const wavetable: Draw = (g, v) => {
  g.grid(8, 4);
  const cells = Array.from({ length: 32 }, (_, i) => v[`wv${i}`]);
  g.wave((ph) => cells[(ph * 32) | 0] * (2 / 15) - 1, 2, 32, g.h / 2 - 10, levelAlpha(v.wvLevel));
  g.text('32 × 4-bit', g.w - 8, 13, 'right');
};

const noise: Draw = (g, v) => {
  g.grid(4);
  const short = Math.round(v.nzMode) === 0;
  // the 15-bit LFSR, as the chip shifts it
  let s = 1;
  const bits: number[] = [];
  for (let i = 0; i < 160; i++) {
    const fb = (s ^ (s >> (short ? 6 : 1))) & 1;
    s = (s >> 1) | (fb << 14);
    bits.push(s & 1 ? 1 : -1);
  }
  const n = bits.length, amp = g.h / 2 - 10, mid = g.h / 2;
  const pts: [number, number][] = [];
  bits.forEach((b, i) => { const y = mid - b * amp; pts.push([(i / n) * g.w, y], [((i + 1) / n) * g.w, y]); });
  g.trace(pts, { base: mid, alpha: levelAlpha(v.nzLevel), width: 1.2 });
  g.text(short ? 'short · 93 steps' : 'long · 32767 steps', g.w - 8, 13, 'right');
};

const fm: Draw = (g, v) => {
  g.grid(4);
  const idx = v.fmIndex * 8, ratio = v.fmRatio, fbk = v.fmFb;
  let prev = 0;
  g.wave((ph) => {
    const m = Math.sin(Math.PI * 2 * ((ph * ratio) % 1) + fbk * 2 * prev);
    prev = m;
    return Math.sin(Math.PI * 2 * ph + idx * m);
  }, 2, 180, g.h / 2 - 10, levelAlpha(v.fmLevel));
  g.text(`ratio ${ratio.toFixed(2)} · index ${idx.toFixed(1)}`, g.w - 8, 13, 'right');
};

const phaseDist: Draw = (g, v) => {
  g.grid(4);
  const shape = Math.round(v.pdShape);
  g.wave((ph) => pd(ph, shape, v.pdAmt), 2, 180, g.h / 2 - 10, levelAlpha(v.pdLevel));
  g.text(['saw', 'square', 'pulse', 'dbl sine', 'reso saw', 'reso tri'][shape], g.w - 8, 13, 'right');
};

/** The unison stack: each voice faint, the sum bold. Detune is exaggerated so the beating shows. */
const unisonSaw: Draw = (g, v) => {
  g.grid(4);
  const nv = Math.max(1, Math.round(v.swVoices)), square = Math.round(v.swShape) === 1;
  const mid = g.h / 2, amp = g.h / 2 - 10, cycles = 3, steps = 240;
  const wave = (ph: number) => (square ? (ph < 0.5 ? 1 : -1) : 2 * ph - 1);
  const alpha = levelAlpha(v.swLevel);
  const sum = new Float32Array(steps + 1);
  for (let u = 0; u < nv; u++) {
    const pos = nv > 1 ? (2 * u) / (nv - 1) - 1 : 0;
    const ratio = 1 + pos * v.swDetune * 0.0035;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const y = wave((((i / steps) * cycles * ratio) % 1 + 1) % 1);
      sum[i] += y / nv;
      pts.push([(i / steps) * g.w, mid - y * amp * 0.9]);
    }
    if (nv > 1) g.trace(pts, { fill: false, alpha: alpha * 0.22, width: 1 });
  }
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) pts.push([(i / steps) * g.w, mid - sum[i] * amp * 0.9]);
  g.trace(pts, { base: mid, alpha });
  g.text(`${nv} voice${nv > 1 ? 's' : ''} · ±${Math.round(v.swDetune)} ct · ${square ? 'square' : 'saw'}`, g.w - 8, 13, 'right');
};

const machine: Draw = (g, v) => {
  // a high sine through the internal clock: the lower the rate, the coarser the steps
  g.grid(4);
  const rate = CLOCK_HZ[Math.round(v.clock)], f = 2093;           // C7
  const steps = Math.max(2, rate / f);
  g.wave((ph) => Math.sin(Math.PI * 2 * ph), 3, steps, g.h / 2 - 10);
  g.text(`${CLOCKS[Math.round(v.clock)]} · ${Math.round(v.mode) ? 'modern' : 'chip'}`, g.w - 8, 13, 'right');
};

const chord: Draw = (g, v) => {
  const { w, h } = g;
  const c = Math.round(v.chord), semis = CHORD_SEMIS[c] ?? [0];
  const oct = v.chordOct >= 0.5, dir = Math.round(v.chordDir), speed = Math.round(v.chordSpeed);
  const notes = oct ? [...semis, ...semis.map((s) => s + 12)] : semis;
  let seq = notes.slice();
  if (dir === 1) seq.reverse(); else if (dir === 2 && notes.length > 1) seq = [...notes, ...notes.slice(1, -1).reverse()];
  const top = Math.max(12, ...notes), steps = 24, sw = w / steps;
  g.grid(steps / 4, 1);
  if (c === 0) { g.text('off — one key, one note', w / 2, h / 2 + 3, 'center', 0.4); return; }
  // one interval per `speed` frames, cycling
  for (let i = 0; i < steps; i++) {
    const n = seq[Math.floor(i / speed) % seq.length];
    const y = h - 8 - (n / top) * (h - 22);
    g.bar(i * sw + 1, y, sw - 2, 4, 0.95);
  }
  g.text(`${semis.map((s) => `+${s}`).join(' ')} · ${speed} f`, w - 8, 13, 'right');
};

const arp: Draw = (g, v) => {
  const { w, h } = g;
  const mode = Math.round(v.arpMode), oct = Math.round(v.arpOct), gate = v.arpGate;
  const steps = 16, sw = w / steps;
  g.grid(4, 1);
  if (mode === 0) { g.text('off — hold a chord with the arp on', w / 2, h / 2 + 3, 'center', 0.4); return; }
  const seq: number[] = [];
  for (let o = 0; o < oct; o++) for (const n of [0, 4, 7]) seq.push(n + o * 12);
  const L = seq.length, top = seq[L - 1] || 1;
  for (let i = 0; i < steps; i++) {
    let n: number;
    if (mode === 1 || mode === 5) n = seq[i % L];
    else if (mode === 2) n = seq[L - 1 - (i % L)];
    else if (mode === 3) { const p = (2 * L - 2) || 1, k = i % p; n = seq[k < L ? k : p - k]; }
    else n = seq[Math.floor(Math.abs(Math.sin(i * 91.7) * 1000)) % L];
    const y = h - 8 - ((n + 1) / (top + 1)) * (h - 20);
    g.bar(i * sw + 2, y, Math.max(2, sw * gate - 3), 4, 0.95);
  }
  g.text(`every ${Math.round(v.arpDiv)} frames`, w - 8, 13, 'right');
};

const clock: Draw = (g, v) => {
  const { w, h } = g;
  const hz = v.frameSync >= 0.5 ? (v.tempo / 60) * 24 : v.frameHz;
  const span = 0.25;                                             // a quarter of a second
  const n = Math.min(80, Math.round(hz * span));
  for (let i = 0; i < n; i++) {
    const x = 6 + (i / Math.max(1, n)) * (w - 12);
    const big = v.frameSync >= 0.5 ? i % 24 === 0 : i % 4 === 0;
    g.bar(x, big ? 10 : h * 0.45, Math.max(1.5, (w / n) * 0.35), big ? h - 18 : h * 0.4, big ? 1 : 0.6);
  }
  g.text(`${hz.toFixed(hz < 100 ? 1 : 0)} Hz${v.frameSync >= 0.5 ? ' · sync' : ''}`, w - 8, 13, 'right');
};

const svf: Draw = (g, v) => {
  const { w, h } = g;
  g.grid(6, 3);
  const mode = Math.round(v.fMode);
  const fmin = 20, fmax = 20000, lmin = Math.log(fmin), lmax = Math.log(fmax);
  const xOf = (f: number) => ((Math.log(f) - lmin) / (lmax - lmin)) * w;
  const yOf = (db: number) => 10 + ((18 - Math.max(-48, Math.min(18, db))) / 66) * (h - 14);
  const fc = v.cutoff, q = 1 - v.res * 0.985;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 200; i++) {
    const f = Math.exp(lmin + (i / 200) * (lmax - lmin));
    const s = f / fc;
    // s² + q s + 1 at s = jw: real 1 - w², imaginary q w
    const den = Math.hypot(1 - s * s, q * s);
    const num = mode === 1 ? 1 : mode === 2 ? q * s : mode === 3 ? s * s : den;
    pts.push([xOf(f), yOf(20 * Math.log10(num / den))]);
  }
  g.trace(pts, { base: h, alpha: mode === 0 ? 0.3 : 1 });
  if (mode > 0) g.dot(xOf(fc), yOf(0), 2.5);
  g.text(`${['off', 'lp', 'bp', 'hp'][mode]} · ${fc >= 1000 ? `${(fc / 1000).toFixed(1)} k` : `${Math.round(fc)} Hz`}`, w - 8, 13, 'right');
};

const echo: Draw = (g, v) => {
  const { w, h } = g;
  g.grid(8, 1);
  const frames = Math.round(v.echoFrames);
  const hz = v.frameSync >= 0.5 ? (v.tempo / 60) * 24 : v.frameHz;
  const dt = frames / hz, span = 1.5, mid = h / 2, room = mid - 6, bw = 5;
  g.bar(6, mid - room, bw, room * 2, 1);
  if (frames === 0) { g.text('off', w - 8, 13, 'right'); return; }
  // 4-bit feedback: each repeat is the last one times fb/15, truncated to 1/8 steps
  let a = Math.floor(v.echoMix * 8) / 8, i = 1;
  while (i * dt <= span && a > 0.05) {
    const x = 6 + ((i * dt) / span) * (w - 18);
    const len = room * a;
    if (v.echoPing >= 0.5) g.bar(x, i % 2 ? mid - len : mid, bw, len, 0.5 + a * 0.5);
    else g.bar(x, mid - len, bw, len * 2, 0.5 + a * 0.5);
    a = Math.floor(a * (v.echoFb / 15) * 8) / 8;
    i++;
  }
  g.ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; g.ctx.fillRect(0, mid, w, 1);
  g.text(`${frames} f · ${Math.round(dt * 1000)} ms`, w - 8, 13, 'right');
};

/** The three delay taps drifting around the centre delay; the shaded band is the swing. */
const chorus: Draw = (g, v) => {
  const { w, h } = g;
  g.grid(8, 2);
  const mid = h / 2, swing = (h / 2 - 10) * v.chDepth, a = v.chMix > 0 ? 1 : 0.3;
  const cycles = Math.max(0.5, Math.min(4, v.chRate * 2));   // two seconds of the LFO
  for (let k = 0; k < 3; k++) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 160; i++) pts.push([(i / 160) * w, mid + Math.sin(Math.PI * 2 * ((i / 160) * cycles + k / 3)) * swing]);
    g.trace(pts, { fill: false, alpha: a * (k === 0 ? 1 : 0.45), width: k === 0 ? 2 : 1 });
  }
  g.text(`${Math.round(v.chMix * 100)}% · ${v.chRate.toFixed(2)} Hz${v.width !== 1 ? ` · width ${Math.round(v.width * 100)}%` : ''}`, w - 8, 13, 'right');
};

/** The mix level over time: a duck on every Nth frame, recovering over the release. */
const pump: Draw = (g, v) => {
  const { w, h } = g;
  g.grid(8, 2);
  if (v.pumpAmt <= 0) { g.text('off', w - 8, 13, 'right'); return; }
  const hz = v.frameSync >= 0.5 ? (v.tempo / 60) * 24 : v.frameHz;
  const period = Math.max(1, Math.round(v.pumpDiv)) / hz, span = period * 3.2;
  const top = 18, bottom = h - 8, pts: [number, number][] = [];
  for (let i = 0; i <= 240; i++) {
    const t = (i / 240) * span, ts = t % period;
    const e = ts < 0.004 ? ts / 0.004 : Math.exp(-3 * (ts - 0.004) / v.pumpRel);
    const gain = 1 - v.pumpAmt * e;
    pts.push([(i / 240) * w, bottom - gain * (bottom - top)]);
  }
  g.trace(pts, { base: bottom });
  g.text(`every ${Math.round(v.pumpDiv)} f · ${Math.round(period * 1000)} ms`, w - 8, 13, 'right');
};

const plate: Draw = (g, v) => {
  const { w, h } = g;
  g.grid(6);
  const span = 3, dec = v.rvDecay;
  const gate = v.rvGate > 0 ? 0.02 + v.rvGate * 0.38 : Infinity;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * span;
    const pre = 0.01 + v.rvSize * 0.03;
    let lvl = t < pre ? t / pre : Math.exp((-6.9 * (t - pre)) / dec);
    if (t > gate + 0.12) lvl = 0; else if (t > gate) lvl *= 1 - (t - gate) / 0.12;   // the gate slams shut
    pts.push([(i / 200) * w, h - 6 - lvl * (h - 16) * (0.25 + v.rvMix * 0.75)]);
  }
  g.trace(pts, { base: h });
  g.text(v.rvGate > 0 ? `gate ${Math.round(gate * 1000)} ms` : `${dec.toFixed(1)} s`, w - 8, 13, 'right');
};

const link: Draw = (g, v) => {
  const { w, h } = g;
  g.grid(8);
  // a sine through the link: word length, packet holes, jitter
  const levels = Math.pow(2, Math.min(7, v.lkBits - 1));          // exaggerated so 8+ bits still show a stair
  const coarse = v.lkBits < 16;
  const n = 400, mid = h / 2, amp = h / 2 - 10;
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const packet = Math.max(6, (v.lkFrame / 20) * 50);
  let pts: [number, number][] = [];
  let lost = false;
  for (let i = 0; i < n; i++) {
    if (i % Math.round(packet) === 0) {
      const was = lost; lost = rnd() < v.lkLoss * 0.6;
      if (lost && !was) { g.trace(pts, { fill: false }); pts = []; }
    }
    const x = (i / n) * w + (rnd() - 0.5) * v.lkJitter * 6;
    let s = Math.sin((i / n) * Math.PI * 6);
    if (coarse) s = Math.round(s * levels) / levels;
    if (rnd() < v.lkBer * 0.05) s = (rnd() - 0.5) * 2;          // a flipped high bit
    if (lost) {
      if (Math.round(v.lkConceal) === 0) { if (pts.length) { g.trace(pts, { fill: false }); pts = []; } continue; }
      s *= 0.6;
    }
    pts.push([x, mid - s * amp]);
  }
  g.trace(pts, { fill: false });
  g.text(`${v.lkBits | 0}-bit${v.lkLoss > 0 ? ` · ${Math.round(v.lkLoss * 100)}% loss` : ''}${v.lkCodec > 0 ? ` · ${Math.round(v.lkKbps)} kbps` : ''}`, w - 8, 13, 'right');
};

export const VIZ: Record<string, Draw> = {
  p1: pulse('p1'), p2: pulse('p2'), wv: wavetable, nz: noise, fm, pd: phaseDist, sw: unisonSaw,
  machine, chord, arp, clock, svf, echo, plate, link, chorus, pump,
};

/** One module's picture: a canvas that redraws itself from the values. */
export class Viz {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private queued = false;

  constructor(private kind: string, private values: ParamValues, tall = false) {
    const el = document.createElement('canvas');
    el.className = tall ? 'viz tall' : 'viz';
    this.el = el;
    this.ctx = el.getContext('2d')!;
    new ResizeObserver(() => this.redraw()).observe(el);
  }

  /** Coalesced to one draw per frame, however many knobs moved. */
  redraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.draw(); });
  }

  private draw(): void {
    const r = { width: this.el.clientWidth, height: this.el.clientHeight };   // layout size: the plugin scales the page
    if (r.width === 0) return;                         // hidden tab: drawn when shown
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (this.el.width !== W || this.el.height !== H) { this.el.width = W; this.el.height = H; }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, r.width, r.height);
    // the module's accent, resolved: the canvas's CSS colour is var(--accent)
    const rgb = getComputedStyle(this.el).color.match(/\d+(\.\d+)?/g)?.slice(0, 3).join(', ') ?? '25, 230, 255';
    // the graph is clipped to its own box and the caption has a band of its own under it
    const CAP = 18, gh = Math.max(24, r.height - CAP);
    const ctx = this.ctx;
    ctx.save(); ctx.beginPath(); ctx.rect(2, 2, r.width - 4, gh - 3); ctx.clip();
    ctx.translate(0, 5);                                  // and inset a little, so a full-scale curve stays off the border
    const pen = new Pen(ctx, r.width, gh - 10, rgb);
    VIZ[this.kind]?.(pen, this.values);
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)'; ctx.fillRect(0, gh, r.width, 1);
    if (pen.cap) {
      ctx.font = '500 10.5px "Geist Mono", "FT Symbols", ui-monospace, monospace';
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.fillText(pen.cap.toUpperCase(), r.width - 14, gh + 13);
    }
  }
}
