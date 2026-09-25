// Offline render / sanity check. Runs the DSP core in Node (no browser),
// writes WAVs and prints level statistics.
//
//   node scripts/render.ts                   -> out/<preset>.wav for every preset (short phrase each)
//   node scripts/render.ts preset "Thomas"   -> out/preset.wav (one preset, a chord + phrase)
//   node scripts/render.ts note 60 100       -> out/note.wav (init patch, one note)
//   node scripts/render.ts bench             -> CPU timing only
//   node scripts/render.ts spectrum 84       -> harmonics / alias of a raw 50 % pulse at that note, per internal rate
//   node scripts/render.ts tuning            -> divider tuning error per note
//   node scripts/render.ts codec             -> codec transparency check at the top bitrate

import { writeFileSync, mkdirSync } from 'node:fs';
import { VectorEngine } from '../src/dsp/engine.ts';
import { PRESETS, CLOCKS } from '../src/dsp/params.ts';
import { dividerTune } from '../src/dsp/chip.ts';

const FS = 48000;
const BLOCK = 128;

type Ev = { t: number; fn: () => void };

function render(e: VectorEngine, seconds: number, events: Ev[]): [Float32Array, Float32Array] {
  const total = Math.ceil(seconds * FS / BLOCK) * BLOCK;
  const L = new Float32Array(total), R = new Float32Array(total);
  events.sort((a, b) => a.t - b.t);
  let ev = 0;
  for (let off = 0; off < total; off += BLOCK) {
    const t = off / FS;
    while (ev < events.length && events[ev].t <= t) events[ev++].fn();
    e.process(L.subarray(off, off + BLOCK), R.subarray(off, off + BLOCK), BLOCK);
  }
  return [L, R];
}

function writeWav(path: string, L: Float32Array, R: Float32Array): void {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  mkdirSync('out', { recursive: true });
  writeFileSync(path, buf);
  console.log(`wrote ${path} (${(n / FS).toFixed(2)} s)`);
}

const db = (x: number) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);

function stats(L: Float32Array, R: Float32Array, label = ''): boolean {
  let peak = 0, nan = 0, sq = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) nan++;
    if (a > peak) peak = a; if (b > peak) peak = b;
    sq += L[i] * L[i];
  }
  console.log(`${label} peak ${db(peak)} dBFS, rms ${db(Math.sqrt(sq / L.length))} dBFS${nan ? `  !!! ${nan} non-finite samples` : ''}`);
  return nan === 0;
}

function envelope(L: Float32Array, win = 0.25, maxRows = 40): void {
  const w = Math.floor(win * FS);
  const rows: string[] = [];
  for (let off = 0; off + w <= L.length && rows.length < maxRows; off += w) {
    let s = 0;
    for (let i = off; i < off + w; i++) s += L[i] * L[i];
    rows.push(`${(off / FS).toFixed(1)}s ${db(Math.sqrt(s / w)).padStart(6)}`);
  }
  console.log(rows.join(' | '));
}

/** A short phrase that shows a preset off: chord, then a few melody notes. */
function phrase(e: VectorEngine, seconds = 7): [Float32Array, Float32Array] {
  const ev: Ev[] = [];
  const play = (t: number, n: number, v: number, dur: number) => {
    ev.push({ t, fn: () => e.noteOn(n, v) });
    ev.push({ t: t + dur, fn: () => e.noteOff(n) });
  };
  play(0.1, 48, 90, 3.2); play(0.1, 55, 85, 3.2); play(0.12, 60, 88, 3.2); play(0.14, 63, 84, 3.2); play(0.16, 67, 92, 3.2);
  play(3.6, 72, 100, 0.5); play(4.0, 70, 90, 0.5); play(4.4, 67, 95, 0.9); play(5.2, 63, 80, 1.2);
  return render(e, seconds, ev);
}

/** Magnitude of one frequency over N samples from `a`, Hann-windowed. */
function mag(L: Float32Array, a: number, N: number, f: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const ph = 2 * Math.PI * f * i / FS;
    re += L[a + i] * w * Math.cos(ph); im -= L[a + i] * w * Math.sin(ph);
  }
  return Math.hypot(re, im) * 2 / N;
}

const mode = process.argv[2] ?? 'all';
const outDir = 'out';

if (mode === 'note') {
  const note = Number(process.argv[3] ?? 60), vel = Number(process.argv[4] ?? 100);
  const e = new VectorEngine(FS);
  const [L, R] = render(e, 4, [
    { t: 0.05, fn: () => e.noteOn(note, vel) },
    { t: 2.0, fn: () => e.noteOff(note) },
  ]);
  stats(L, R, `note ${note} vel ${vel}:`);
  envelope(L, 0.1);
  writeWav(`${outDir}/note.wav`, L, R);
} else if (mode === 'preset') {
  const name = process.argv[3] ?? PRESETS[0].name;
  const pr = PRESETS.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!pr) throw new Error(`no preset matching "${name}"`);
  const e = new VectorEngine(FS);
  e.loadPreset(pr.values);
  const [L, R] = phrase(e, 9);
  stats(L, R, `${pr.name}:`);
  envelope(L);
  writeWav(`${outDir}/preset.wav`, L, R);
} else if (mode === 'bench') {
  for (const name of ['Sleeper Pad', 'Underwater', 'Thomas']) {
    const pr = PRESETS.find((p) => p.name === name)!;
    const e = new VectorEngine(FS);
    e.loadPreset(pr.values);
    e.setParam('mode', 1);
    const chord = [48, 55, 60, 64, 67, 72, 76, 79];
    for (const n of chord) e.noteOn(n, 100);
    const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
    const blocks = Math.floor(5 * FS / BLOCK);
    const t0 = performance.now();
    for (let i = 0; i < blocks; i++) e.process(L, R, BLOCK);
    const ms = performance.now() - t0;
    console.log(`rendered 5 s with ${chord.length} voices of "${name}" in ${ms.toFixed(0)} ms  => ${(ms / 5000 * 100).toFixed(1)}% of real time`);
  }
} else if (mode === 'spectrum') {
  // raw 50 % pulse, no fx: harmonic levels and the worst alias between h1 and h2, per internal rate
  const note = Number(process.argv[3] ?? 84);
  const f0 = 440 * Math.pow(2, (note - 69) / 12);
  for (let clock = 0; clock < CLOCKS.length; clock++) {
    const e = new VectorEngine(FS);
    e.setParams({ clock, precision: 1, p1Duty: 2, p1Atk: 0.001, p1Sus: 1, rvMix: 0, vel: 0 });
    const [L] = render(e, 1.6, [{ t: 0, fn: () => e.noteOn(note, 100) }]);
    const N = 32768, a = FS / 2;
    const h1 = mag(L, a, N, f0);
    const rows: string[] = [];
    for (let k = 1; k <= 5; k++) rows.push(`h${k} ${db(mag(L, a, N, k * f0) / h1).padStart(6)}`);
    let worst = -200;
    for (let f = f0 * 1.1; f < f0 * 1.9; f += f0 * 0.02) worst = Math.max(worst, 20 * Math.log10(mag(L, a, N, f) / h1));
    console.log(`${CLOCKS[clock].padStart(6)}: ${rows.join('  ')}   worst alias between h1 and h2: ${worst.toFixed(1)} dB`);
  }
} else if (mode === 'tuning') {
  console.log('divider tuning error (precision 0), cents:');
  for (let n = 36; n <= 108; n += 6) {
    const f = 440 * Math.pow(2, (n - 69) / 12);
    const c = 1200 * Math.log2(dividerTune(f, 0) / f);
    console.log(`  note ${n}: ${f.toFixed(1).padStart(7)} Hz -> ${(c >= 0 ? '+' : '') + c.toFixed(1)} ct`);
  }
} else if (mode === 'codec') {
  // a sine through the coder with everything else off, at the top bitrate: should come back nearly intact
  const e = new VectorEngine(FS);
  e.setParams({ clock: 7, precision: 1, p1Level: 0, fmLevel: 0.8, fmIndex: 0, fmAtk: 0.001, fmSus: 1, rvMix: 0, vel: 0 });
  const [dry] = render(e, 1.5, [{ t: 0, fn: () => e.noteOn(69, 100) }]);
  const e2 = new VectorEngine(FS);
  e2.setParams({ clock: 7, precision: 1, p1Level: 0, fmLevel: 0.8, fmIndex: 0, fmAtk: 0.001, fmSus: 1, rvMix: 0, vel: 0, lkCodec: 1, lkKbps: 128 });
  const [wet] = render(e2, 1.5, [{ t: 0, fn: () => e2.noteOn(69, 100) }]);
  let err = 0, sig = 0;
  const lat = 512;
  for (let i = FS / 2; i < FS; i++) { const d = wet[i + lat] - dry[i]; err += d * d; sig += dry[i] * dry[i]; }
  console.log(`codec at 128 kbps, 440 Hz sine: error ${db(Math.sqrt(err / sig))} dB re signal (latency ${lat} samples)`);
  for (const kbps of [64, 32, 16, 8]) {
    const e3 = new VectorEngine(FS);
    e3.setParams({ clock: 7, precision: 1, p1Level: 0, fmLevel: 0.8, fmIndex: 0, fmAtk: 0.001, fmSus: 1, rvMix: 0, vel: 0, lkCodec: 1, lkKbps: kbps });
    const [w] = render(e3, 1.5, [{ t: 0, fn: () => e3.noteOn(69, 100) }]);
    let er = 0, sg = 0;
    for (let i = FS / 2; i < FS; i++) { const d = w[i + lat] - dry[i]; er += d * d; sg += dry[i] * dry[i]; }
    console.log(`  ${String(kbps).padStart(3)} kbps: error ${db(Math.sqrt(er / sg))} dB`);
  }
} else {
  let ok = true;
  for (const pr of PRESETS) {
    const e = new VectorEngine(FS);
    e.loadPreset(pr.values);
    const [L, R] = phrase(e, 8);
    ok = stats(L, R, pr.name.padEnd(18)) && ok;
    writeWav(`${outDir}/${pr.name.toLowerCase().replace(/\s+/g, '-')}.wav`, L, R);
  }
  if (!ok) { console.error('non-finite output!'); process.exit(1); }
}
