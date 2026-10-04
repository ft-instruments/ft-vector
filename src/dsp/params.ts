// The user-facing parameters of the instrument, as a flat list, plus the
// factory presets. `PARAMS` is what a plugin host would see as the
// parameter list; every value is a plain number. The drawn tables (wave,
// two volume tables, pitch table) are flat too: one parameter per cell.

export type Scale = 'lin' | 'log' | 'int' | 'enum' | 'bool';

export interface ParamDef {
  id: string;
  name: string;
  group: string;
  min: number;
  max: number;
  def: number;
  scale: Scale;
  unit?: string;
  labels?: string[];   // for enum
  tab?: string;        // cell of a drawn table: which table ...
  idx?: number;        // ... and which cell
}

export const MODES = ['chip', 'modern'];
export const CLOCKS = ['8k', '11k', '16k', '22k', '32k', '44.1k', '48k', '96k'];
export const CLOCK_HZ = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000];
export const DUTIES = ['12.5', '25', '50', '75', 'free'];
export const DUTY_VALUES = [0.125, 0.25, 0.5, 0.75];
export const ENV_MODES = ['adsr', 'tab A', 'tab B'];
export const NOISE_MODES = ['short', 'long'];
export const PD_SHAPES = ['saw', 'square', 'pulse', 'dbl sine', 'reso saw', 'reso tri'];
export const REG_OPS = ['tri', 'count', 'rotate', 'xor', 'lfsr'];
export const ARP_MODES = ['off', 'up', 'down', 'up/dn', 'random', 'played'];
export const CHORDS = ['off', 'oct', '5th', 'maj', 'min', 'sus4', 'maj7', 'min7', 'dom7', 'dim', 'aug', 'oct+2'];
export const CHORD_SEMIS: number[][] = [[0], [0, 12], [0, 7], [0, 4, 7], [0, 3, 7], [0, 5, 7], [0, 4, 7, 11], [0, 3, 7, 10], [0, 4, 7, 10], [0, 3, 6], [0, 4, 8], [0, 12, 24]];
export const CHORD_DIRS = ['up', 'down', 'up/dn'];
export const FILTER_MODES = ['off', 'lp', 'bp', 'hp'];
export const CONCEAL = ['mute', 'repeat', 'smear', 'continue'];
export const DITHERS = ['none', 'tpdf', 'shaped'];

const P = (id: string, name: string, group: string, min: number, max: number, def: number, scale: Scale = 'lin', unit?: string, labels?: string[]): ParamDef =>
  ({ id, name, group, min, max, def, scale, unit, labels });

/** The six channels, in order. Each is mono-timbral like a chip channel. */
export const CHANNELS = [
  { pre: 'p1', name: 'pulse 1' },
  { pre: 'p2', name: 'pulse 2' },
  { pre: 'wv', name: 'wave' },
  { pre: 'nz', name: 'noise' },
  { pre: 'fm', name: 'fm' },
  { pre: 'pd', name: 'pd' },
] as const;
export type ChannelPrefix = typeof CHANNELS[number]['pre'];

function channel(pre: string, level: number, octMin = -2, octMax = 2): ParamDef[] {
  return [
    P(`${pre}Level`, 'level', pre, 0, 1, level),
    P(`${pre}Oct`, 'octave', pre, octMin, octMax, 0, 'int'),
    P(`${pre}Semi`, 'semi', pre, -12, 12, 0, 'int'),
    P(`${pre}Fine`, 'fine', pre, -50, 50, 0, 'lin', 'ct'),
    P(`${pre}Pan`, 'pan', pre, -1, 1, 0),
    P(`${pre}Env`, 'env', pre, 0, 2, 0, 'enum', undefined, ENV_MODES),
    P(`${pre}Atk`, 'attack', pre, 0.001, 8, 0.002, 'log', 's'),
    P(`${pre}Dec`, 'decay', pre, 0.005, 8, 0.3, 'log', 's'),
    P(`${pre}Sus`, 'sustain', pre, 0, 1, 0.7),
    P(`${pre}Rel`, 'release', pre, 0.005, 10, 0.08, 'log', 's'),
    P(`${pre}PTab`, 'pitch tab', pre, 0, 1, 0, 'bool'),
  ];
}

function table(pre: string, name: string, group: string, n: number, min: number, max: number, def: (i: number) => number): ParamDef[] {
  const out: ParamDef[] = [];
  for (let i = 0; i < n; i++) {
    const d = P(`${pre}${i}`, `${name} ${i}`, group, min, max, def(i), 'int');
    d.tab = pre; d.idx = i;
    out.push(d);
  }
  return out;
}

export const PARAMS: ParamDef[] = [
  // ---- the machine
  P('mode', 'mode', 'chip', 0, 1, 0, 'enum', undefined, MODES),
  P('clock', 'rate', 'chip', 0, 7, 6, 'enum', undefined, CLOCKS),
  P('precision', 'precision', 'chip', 0, 1, 0),
  P('cycle', 'cycle', 'chip', 0, 1, 0.3),
  P('vel', 'velocity', 'chip', 0, 1, 0.5),
  P('bend', 'bend range', 'chip', 0, 24, 2, 'int', 'st'),
  P('glide', 'glide', 'chip', 0, 12, 0, 'lin', 'st/frame'),
  // ---- chord arp: the 8-bit chord, one interval per frame from a single key
  P('chord', 'chord', 'chord', 0, 11, 0, 'enum', undefined, CHORDS),
  P('chordSpeed', 'frames', 'chord', 1, 8, 1, 'int'),
  P('chordDir', 'direction', 'chord', 0, 2, 0, 'enum', undefined, CHORD_DIRS),
  P('chordOct', 'octave', 'chord', 0, 1, 0, 'bool'),
  // ---- channels
  ...channel('p1', 0.8),
  P('p1Duty', 'duty', 'p1', 0, 4, 1, 'enum', undefined, DUTIES),
  P('p1Width', 'width', 'p1', 0.02, 0.98, 0.5),
  ...channel('p2', 0),
  P('p2Duty', 'duty', 'p2', 0, 4, 2, 'enum', undefined, DUTIES),
  P('p2Width', 'width', 'p2', 0.02, 0.98, 0.5),
  P('p2Xor', 'xor pulse 1', 'p2', 0, 1, 0, 'bool'),
  ...channel('wv', 0),
  ...channel('nz', 0, -2, 4),
  P('nzMode', 'mode', 'nz', 0, 1, 1, 'enum', undefined, NOISE_MODES),
  ...channel('fm', 0),
  P('fmRatio', 'ratio', 'fm', 0.25, 16, 2, 'log'),
  P('fmIndex', 'index', 'fm', 0, 1, 0.3),
  P('fmFb', 'feedback', 'fm', 0, 1, 0),
  P('fmEnvAmt', 'env → index', 'fm', 0, 1, 0.5),
  ...channel('pd', 0),
  P('pdShape', 'shape', 'pd', 0, 5, 0, 'enum', undefined, PD_SHAPES),
  P('pdAmt', 'distort', 'pd', 0, 1, 0.5),
  P('pdEnvAmt', 'env → distort', 'pd', 0, 1, 0.5),
  // ---- drawn tables
  ...table('wv', 'wave', 'wave', 32, 0, 15, (i) => (i < 16 ? i : 31 - i)),          // NES triangle
  ...table('tvA', 'vol A', 'tabA', 16, 0, 15, (i) => Math.max(0, 15 - i * 2)),        // pluck
  ...table('tvB', 'vol B', 'tabB', 16, 0, 15, (i) => [15, 12, 15, 10, 15, 8, 15, 6, 15, 4, 15, 2, 15, 15, 15, 15][i]), // tremolo
  ...table('tp', 'pitch', 'tabP', 16, -12, 12, () => 0),
  P('tabDiv', 'frames/step', 'tables', 1, 8, 1, 'int'),
  P('tvALoop', 'loop A', 'tables', 0, 16, 16, 'int'),
  P('tvBLoop', 'loop B', 'tables', 0, 16, 0, 'int'),
  P('tpLoop', 'loop P', 'tables', 0, 16, 16, 'int'),
  // ---- frame clock
  P('frameHz', 'frame', 'frame', 8, 240, 60, 'log', 'Hz'),
  P('frameSync', 'sync', 'frame', 0, 1, 0, 'bool'),
  P('tempo', 'tempo', 'frame', 40, 240, 120, 'int', 'bpm'),
  // ---- register 1
  P('r1Op', 'op', 'r1', 0, 4, 0, 'enum', undefined, REG_OPS),
  P('r1Step', 'step', 'r1', 1, 255, 16, 'int'),
  P('r1Mask', 'mask', 'r1', 0, 255, 255, 'int'),
  P('r1Div', 'div', 'r1', 1, 16, 1, 'int'),
  P('r1Pitch', '→ pitch', 'r1', -1200, 1200, 0, 'lin', 'ct'),
  P('r1Duty', '→ duty', 'r1', -1, 1, 0),
  P('r1Level', '→ level', 'r1', 0, 1, 0),
  P('r1Cut', '→ cutoff', 'r1', -1, 1, 0),
  // ---- register 2
  P('r2Op', 'op', 'r2', 0, 4, 2, 'enum', undefined, REG_OPS),
  P('r2Step', 'step', 'r2', 1, 255, 15, 'int'),
  P('r2Mask', 'mask', 'r2', 0, 255, 255, 'int'),
  P('r2Div', 'div', 'r2', 1, 16, 4, 'int'),
  P('r2Pitch', '→ pitch', 'r2', -1200, 1200, 0, 'lin', 'ct'),
  P('r2Duty', '→ duty', 'r2', -1, 1, 0),
  P('r2Level', '→ level', 'r2', 0, 1, 0),
  P('r2Cut', '→ cutoff', 'r2', -1, 1, 0),
  // ---- cellular automaton
  P('caRule', 'rule', 'ca', 0, 255, 30, 'int'),
  P('caDiv', 'div', 'ca', 1, 16, 2, 'int'),
  P('caPitch', '→ pitch', 'ca', 0, 24, 0, 'int', 'st'),
  P('caDuty', '→ duty', 'ca', -1, 1, 0),
  P('caLevel', '→ level', 'ca', 0, 1, 0),
  P('caCut', '→ cutoff', 'ca', -1, 1, 0),
  // ---- arp (in frames)
  P('arpMode', 'mode', 'arp', 0, 5, 0, 'enum', undefined, ARP_MODES),
  P('arpDiv', 'frames', 'arp', 1, 32, 8, 'int'),
  P('arpOct', 'octaves', 'arp', 1, 4, 1, 'int'),
  P('arpGate', 'gate', 'arp', 0.05, 1, 0.6),
  P('arpHold', 'latch', 'arp', 0, 1, 0, 'bool'),
  // ---- echo: a software delay counted in frames, 4-bit feedback
  P('echoFrames', 'frames', 'echo', 0, 32, 0, 'int'),
  P('echoFb', 'feedback', 'echo', 0, 15, 8, 'int'),
  P('echoMix', 'mix', 'echo', 0, 1, 0.5),
  P('echoPing', 'ping-pong', 'echo', 0, 1, 0, 'bool'),
  // ---- filter (Chamberlin SVF)
  P('fMode', 'mode', 'filter', 0, 3, 0, 'enum', undefined, FILTER_MODES),
  P('cutoff', 'cutoff', 'filter', 40, 18000, 4000, 'log', 'Hz'),
  P('res', 'resonance', 'filter', 0, 0.95, 0.2),
  // ---- the link
  P('lkJitter', 'jitter', 'link', 0, 1, 0),
  P('lkDrift', 'drift', 'link', 0, 1, 0),
  P('lkCodec', 'codec', 'link', 0, 1, 0),
  P('lkKbps', 'bitrate', 'link', 8, 128, 32, 'log', 'kbps'),
  P('lkLoss', 'loss', 'link', 0, 1, 0),
  P('lkFrame', 'packet', 'link', 1, 20, 8, 'lin', 'ms'),
  P('lkConceal', 'conceal', 'link', 0, 3, 1, 'enum', undefined, CONCEAL),
  P('lkBits', 'bits', 'link', 4, 16, 16, 'int'),
  P('lkDither', 'dither', 'link', 0, 2, 0, 'enum', undefined, DITHERS),
  P('lkBer', 'bit errors', 'link', 0, 1, 0),
  P('lkSpeaker', 'speaker', 'link', 0, 1, 0),
  // ---- plate reverb
  P('rvMix', 'mix', 'reverb', 0, 1, 0.15),
  P('rvSize', 'size', 'reverb', 0, 1, 0.5),
  P('rvDecay', 'decay', 'reverb', 0.1, 10, 1.2, 'log', 's'),
  P('rvTone', 'tone', 'reverb', 0, 1, 0.7),
  P('rvGate', 'gate', 'reverb', 0, 1, 0),
  // ---- output
  P('volume', 'volume', 'out', 0, 1, 0.7),
];

export type ParamId = string;
export type ParamValues = Record<ParamId, number>;

export const PARAM_BY_ID: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

export function defaults(): ParamValues {
  const v: ParamValues = {};
  for (const p of PARAMS) v[p.id] = p.def;
  return v;
}

/** 0..1 knob position -> value, honouring the parameter's scale. */
export function fromNorm(p: ParamDef, t: number): number {
  t = Math.min(1, Math.max(0, t));
  switch (p.scale) {
    case 'log': return p.min * Math.pow(p.max / p.min, t);
    case 'int': case 'enum': case 'bool': return Math.round(p.min + t * (p.max - p.min));
    default: return p.min + t * (p.max - p.min);
  }
}

export function toNorm(p: ParamDef, v: number): number {
  v = Math.min(p.max, Math.max(p.min, v));
  if (p.scale === 'log') return Math.log(v / p.min) / Math.log(p.max / p.min);
  return (v - p.min) / (p.max - p.min);
}

export function format(p: ParamDef, v: number): string {
  if (p.labels) return p.labels[Math.round(v)] ?? String(v);
  if (p.scale === 'bool') return v >= 0.5 ? 'on' : 'off';
  if (p.scale === 'int') return `${Math.round(v)}${p.unit ? ' ' + p.unit : ''}`;
  if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : v >= 100 ? `${v.toFixed(0)} Hz` : `${v.toFixed(2)} Hz`;
  if (p.unit === 's') return v >= 1 ? `${v.toFixed(2)} s` : `${(v * 1000).toFixed(0)} ms`;
  if (p.unit === 'ms') return `${v.toFixed(1)} ms`;
  if (p.unit === 'ct') return `${v.toFixed(0)} ct`;
  if (p.unit === 'kbps') return `${v.toFixed(0)} kbps`;
  if (p.unit === 'st/frame') return v === 0 ? 'off' : `${v.toFixed(2)} st/f`;
  // plain amounts read as percentages; bipolar ones keep their sign
  if (p.min < 0) return (v >= 0 ? '+' : '−') + `${Math.round(Math.abs(v) * 100)}%`;
  return `${Math.round(v * 100)}%`;
}

export interface Preset {
  name: string;
  tag: string;
  values: Partial<ParamValues>;
}

// Helpers for writing tables in presets compactly.
const tab = (pre: string, cells: number[]): Partial<ParamValues> =>
  Object.fromEntries(cells.map((c, i) => [`${pre}${i}`, c]));
const SINE32 = Array.from({ length: 32 }, (_, i) => Math.round(7.5 + 7.5 * Math.sin((i / 32) * Math.PI * 2)));
/** A sum of harmonics (amplitude per harmonic), drawn into the 4-bit table at full scale. */
const harmonics = (amps: number[]): number[] => {
  const raw = Array.from({ length: 32 }, (_, i) => amps.reduce((s, a, h) => s + a * Math.sin(((h + 1) * i / 32) * Math.PI * 2), 0));
  const lo = Math.min(...raw), hi = Math.max(...raw);
  return raw.map((x) => Math.round((x - lo) / (hi - lo) * 15));
};
const SOFTSAW32 = harmonics([1, 1 / 2, 1 / 3, 1 / 4, 1 / 5]);       // a saw with the top rounded off
const HOLLOW32 = harmonics([1, 0, 1 / 3, 0, 1 / 5]);                // a soft square: odd harmonics only
const VOX32 = harmonics([0.6, 1, 0.8, 0.25, 0.15, 0.3]);            // strong 2nd and 3rd: a vowel-ish body
const STRING32 = harmonics([1, 0.55, 0.38, 0.28, 0.22, 0.17, 0.13, 0.1]);   // a brighter saw for strings and leads
const BELL32 = harmonics([1, 0, 0.45, 0, 0, 0.3, 0, 0.2]);                // sparse partials: 1, 3, 6, 8
const CHOIR32 = harmonics([1, 0.25, 0.65, 0.12, 0.4, 0.08, 0.2]);        // a darker vowel than VOX32
const WARM32 = harmonics([1, 0.35, 0.12]);                               // nearly a sine, with a little body
const SAW32 = Array.from({ length: 32 }, (_, i) => Math.round(i / 31 * 15));
const ORGAN32 = Array.from({ length: 32 }, (_, i) => Math.round(7.5 + 4.5 * Math.sin((i / 32) * Math.PI * 2) + 3 * Math.sin((i / 32) * Math.PI * 4)));

// Presets only list what differs from the defaults.
export const PRESETS: Preset[] = [
  {
    name: 'Thomas', tag: 'chip',
    values: {
      p1Duty: 1, p1Level: 0.8, p1Atk: 0.001, p1Dec: 0.25, p1Sus: 0.6, p1Rel: 0.06,
      wvLevel: 0.7, wvOct: -1, wvEnv: 0, wvAtk: 0.001, wvDec: 0.2, wvSus: 0.8, wvRel: 0.05,
      nzLevel: 0.22, nzOct: 3, nzMode: 1, nzEnv: 1, nzPan: 0.3,
      ...tab('tvA', [15, 10, 6, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      chord: 3, chordSpeed: 1,
      r1Op: 0, r1Step: 32, r1Div: 1, r1Pitch: 18,
      echoFrames: 9, echoFb: 6, echoMix: 0.35, echoPing: 1,
      rvMix: 0.12, rvDecay: 0.8,
    },
  },
  {
    name: 'Chord Stab', tag: 'chip',
    values: {
      p1Duty: 2, p1Level: 0.8, p1Env: 1, p1Rel: 0.03,
      p2Duty: 1, p2Level: 0.6, p2Oct: 1, p2Env: 1, p2Rel: 0.03, p2Pan: 0.5,
      ...tab('tvA', [15, 15, 13, 11, 9, 7, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0]),
      chord: 7, chordSpeed: 1, chordDir: 2, chordOct: 1,
      echoFrames: 12, echoFb: 9, echoMix: 0.45, echoPing: 1,
      rvMix: 0.2,
    },
  },
  {
    name: 'Slide Bass', tag: 'chip',
    values: {
      clock: 4, glide: 0.5,
      p1Duty: 2, p1Oct: -1, p1Level: 0.9, p1Atk: 0.001, p1Dec: 0.3, p1Sus: 0.6, p1Rel: 0.05,
      p2Duty: 2, p2Oct: -1, p2Level: 0.7, p2Xor: 1, p2Semi: 7, p2Sus: 0.6, p2Rel: 0.05,
      wvLevel: 0.7, wvOct: -2, wvSus: 0.9, wvRel: 0.05,
      fMode: 1, cutoff: 1200, res: 0.35, r1Op: 1, r1Step: 255, r1Div: 12, r1Cut: -0.25,
      rvMix: 0,
    },
  },
  {
    name: 'Ring Lead', tag: 'chip',
    values: {
      p1Duty: 2, p1Level: 0.7, p1Sus: 0.8, p1Rel: 0.1,
      p2Duty: 2, p2Level: 0.8, p2Xor: 1, p2Semi: 5, p2Fine: 4, p2Sus: 0.8, p2Rel: 0.1,
      frameHz: 60, r1Op: 0, r1Step: 20, r1Div: 1, r1Pitch: 14,
      r2Op: 3, r2Step: 37, r2Mask: 0b01010101, r2Div: 3, r2Duty: 0.3,
      echoFrames: 18, echoFb: 7, echoMix: 0.3,
      rvMix: 0.18, rvDecay: 1.5,
    },
  },
  {
    name: 'Sleeper Pad', tag: 'pad',
    values: {
      mode: 1, cycle: 0.4, clock: 5,
      p1Level: 0,
      wvLevel: 0.7, wvAtk: 1.2, wvDec: 2, wvSus: 0.85, wvRel: 2.5, wvPan: -0.4,
      ...tab('wv', ORGAN32),
      fmLevel: 0.35, fmOct: 1, fmRatio: 2, fmIndex: 0.12, fmFb: 0.1, fmEnvAmt: 0.3, fmAtk: 2.5, fmDec: 3, fmSus: 0.8, fmRel: 3, fmPan: 0.4,
      frameHz: 30, r1Op: 0, r1Step: 12, r1Div: 2, r1Pitch: 9,
      r2Op: 4, r2Div: 8, r2Level: 0.15,
      fMode: 1, cutoff: 3200, res: 0.15,
      lkJitter: 0.2, lkCodec: 0.7, lkKbps: 32, lkDrift: 0.35,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.5,
    },
  },
  {
    name: 'Terminal Bell', tag: 'glass',
    values: {
      mode: 1, cycle: 0,
      p1Level: 0,
      fmLevel: 0.9, fmRatio: 3.5, fmIndex: 0.55, fmFb: 0.05, fmEnvAmt: 0.9, fmAtk: 0.001, fmDec: 0.9, fmSus: 0, fmRel: 0.9,
      lkBer: 0.55, lkBits: 12,
      rvMix: 0.2, rvDecay: 1.5, rvTone: 0.8,
    },
  },
  {
    name: 'Neon Rain', tag: 'glass',
    values: {
      mode: 1, cycle: 0.5, clock: 6,
      p1Level: 0,
      pdLevel: 0.8, pdShape: 3, pdAmt: 0.35, pdEnvAmt: 0.8, pdAtk: 0.002, pdDec: 0.6, pdSus: 0.1, pdRel: 0.7, pdPan: -0.3,
      pdOct: 1,
      frameHz: 24, caRule: 30, caDiv: 1, caPitch: 12, caLevel: 0.3,
      lkLoss: 0.35, lkFrame: 12, lkConceal: 1,
      rvMix: 0.5, rvSize: 0.8, rvDecay: 3, rvTone: 0.75,
    },
  },
  {
    name: 'Corrupted Choir', tag: 'link',
    values: {
      mode: 0, clock: 5,
      p1Duty: 2, p1Level: 0.6, p1Atk: 0.05, p1Dec: 0.5, p1Sus: 0.8, p1Rel: 0.4,
      p2Duty: 1, p2Level: 0.5, p2Fine: 6, p2Atk: 0.05, p2Sus: 0.8, p2Rel: 0.4, p2Pan: 0.5,
      wvLevel: 0.5, wvOct: -1, wvAtk: 0.1, wvSus: 0.8, wvRel: 0.5, wvPan: -0.5, ...tab('wv', SINE32),
      frameHz: 60, r1Op: 0, r1Step: 20, r1Div: 1, r1Pitch: 12,
      lkCodec: 1, lkKbps: 16, lkBits: 12, lkDither: 1,
      rvMix: 0.35, rvSize: 0.7, rvDecay: 2.5,
    },
  },
  {
    name: 'Data Storm', tag: 'link',
    values: {
      p1Level: 0,
      nzLevel: 0.9, nzOct: 2, nzMode: 1, nzAtk: 0.01, nzDec: 1, nzSus: 0.6, nzRel: 0.4,
      frameHz: 90, r2Op: 4, r2Div: 1, r2Level: 0.5, r2Cut: 0.6,
      fMode: 2, cutoff: 1800, res: 0.7,
      lkBer: 0.85, lkJitter: 0.8, lkBits: 8,
      rvMix: 0.5, rvSize: 0.6, rvDecay: 2, rvGate: 0.25, rvTone: 0.9,
    },
  },
  {
    name: 'Metal Hat', tag: 'chip',
    values: {
      p1Level: 0,
      nzLevel: 0.9, nzOct: 4, nzMode: 0, nzEnv: 1, nzAtk: 0.001, nzRel: 0.02,
      ...tab('tvA', [15, 9, 5, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      frameHz: 120, rvMix: 0.05,
    },
  },
  {
    name: 'Square Bass', tag: 'chip',
    values: {
      clock: 4,
      p1Duty: 2, p1Oct: -1, p1Level: 0.9, p1Atk: 0.001, p1Dec: 0.35, p1Sus: 0.5, p1Rel: 0.05,
      wvLevel: 0.8, wvOct: -2, wvSus: 0.9, wvRel: 0.05,
      fMode: 1, cutoff: 1500, res: 0.3, r1Op: 1, r1Step: 255, r1Div: 16, r1Cut: -0.2,
      rvMix: 0,
    },
  },
  {
    name: 'Duty Phaser', tag: 'chip',
    values: {
      p1Duty: 4, p1Width: 0.5, p1Level: 0.7, p1Sus: 0.9, p1Rel: 0.2,
      p2Duty: 4, p2Width: 0.5, p2Level: 0.6, p2Fine: -8, p2Sus: 0.9, p2Rel: 0.2, p2Pan: 0.6,
      frameHz: 60, r1Op: 2, r1Step: 0b00011111, r1Div: 1, r1Duty: 0.45,
      r2Op: 0, r2Step: 4, r2Div: 1, r2Pitch: 6,
      rvMix: 0.2, rvDecay: 1.5,
    },
  },
  {
    name: 'Rule 110', tag: 'seq',
    values: {
      mode: 0, clock: 3,
      p1Duty: 0, p1Level: 0.8, p1Env: 1, p1Rel: 0.05,
      ...tab('tvA', [15, 12, 8, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      wvLevel: 0.6, wvOct: -1, wvEnv: 1, wvRel: 0.05,
      frameHz: 120, frameSync: 1, tempo: 128,
      arpMode: 5, arpDiv: 6, arpOct: 2, arpGate: 0.5,
      caRule: 110, caDiv: 6, caPitch: 7, caDuty: 0.3,
      lkBits: 10, rvMix: 0.25, rvDecay: 1.2,
    },
  },
  {
    name: 'Tracker Lead', tag: 'chip',
    values: {
      p1Duty: 1, p1Level: 0.8, p1Env: 2, p1Rel: 0.04, p1PTab: 1,
      ...tab('tvB', [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 10, 10, 10, 10, 10]),
      tvBLoop: 16,
      ...tab('tp', [12, 12, 7, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      tpLoop: 16,
      frameHz: 60, r1Op: 0, r1Step: 40, r1Div: 1, r1Pitch: 25,
      lkSpeaker: 0.5, rvMix: 0.1,
    },
  },
  {
    name: 'Underwater', tag: 'link',
    values: {
      mode: 1, cycle: 0.2,
      p1Level: 0,
      wvLevel: 0.55, wvAtk: 0.4, wvDec: 1, wvSus: 0.9, wvRel: 1.5, ...tab('wv', SAW32),
      pdLevel: 0.3, pdShape: 4, pdAmt: 0.3, pdEnvAmt: 0.6, pdAtk: 0.5, pdSus: 0.8, pdRel: 1.5, pdOct: -1,
      fMode: 1, cutoff: 2500, res: 0.1,
      lkCodec: 1, lkKbps: 10, lkDrift: 0.5, lkLoss: 0.08, lkFrame: 20, lkConceal: 2,
      rvMix: 0.4, rvSize: 1, rvDecay: 5, rvTone: 0.35, volume: 0.6,
    },
  },
  {
    name: 'Game Boy', tag: 'chip',
    values: {
      clock: 2,
      p1Duty: 1, p1Level: 0.75, p1Atk: 0.001, p1Dec: 0.4, p1Sus: 0.6, p1Rel: 0.05,
      p2Duty: 2, p2Level: 0.55, p2Fine: 5, p2Oct: 0, p2Dec: 0.4, p2Sus: 0.6, p2Rel: 0.05,
      wvLevel: 0.6, wvOct: -1, wvSus: 0.8, wvRel: 0.05,
      r1Op: 0, r1Step: 24, r1Div: 2, r1Pitch: 14,
      lkSpeaker: 1, lkBits: 8, rvMix: 0,
    },
  },
  // ---- more chip
  {
    name: 'Mega Lead', tag: 'chip',
    values: {
      clock: 4,
      p1Duty: 1, p1Level: 0.8, p1Atk: 0.001, p1Dec: 0.15, p1Sus: 0.8, p1Rel: 0.05,
      p2Duty: 1, p2Level: 0.55, p2Oct: 1, p2Fine: -6, p2Atk: 0.001, p2Sus: 0.8, p2Rel: 0.05, p2Pan: 0.4,
      glide: 3, frameHz: 60, r1Op: 0, r1Step: 48, r1Div: 1, r1Pitch: 22,
      echoFrames: 6, echoFb: 5, echoMix: 0.3, echoPing: 1, rvMix: 0.1,
    },
  },
  {
    name: 'Octave Bass', tag: 'chip',
    values: {
      clock: 3,
      p1Duty: 0, p1Oct: -1, p1Level: 0.85, p1Env: 1, p1Rel: 0.03,
      ...tab('tvA', [15, 14, 12, 10, 9, 8, 8, 7, 7, 6, 6, 5, 5, 5, 5, 5]), tvALoop: 16,
      wvLevel: 0.9, wvOct: -2, wvSus: 1, wvRel: 0.03,
      chord: 1, chordSpeed: 1,
      lkBits: 8, rvMix: 0,
    },
  },
  {
    name: 'Pixel Pluck', tag: 'chip',
    values: {
      p1Duty: 0, p1Level: 0.85, p1Env: 1, p1Rel: 0.02, p1PTab: 1,
      ...tab('tvA', [15, 12, 9, 7, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0]),
      ...tab('tp', [12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      nzLevel: 0.15, nzOct: 4, nzMode: 0, nzEnv: 1, nzPan: -0.4,
      echoFrames: 12, echoFb: 7, echoMix: 0.4, echoPing: 1, rvMix: 0.2, rvDecay: 1.5,
    },
  },
  {
    name: 'Boss Fight', tag: 'chip',
    values: {
      clock: 4,
      p1Duty: 2, p1Level: 0.7, p1Sus: 0.9, p1Rel: 0.05,
      p2Duty: 1, p2Level: 0.7, p2Semi: -5, p2Sus: 0.9, p2Rel: 0.05, p2Pan: 0.5,
      wvLevel: 0.8, wvOct: -1, wvSus: 1, wvRel: 0.05,
      chord: 2, chordSpeed: 2, chordDir: 2, chordOct: 1,
      frameHz: 60, r1Op: 4, r1Step: 77, r1Div: 2, r1Pitch: 15, r1Duty: 0.3,
      lkBits: 10, echoFrames: 4, echoFb: 6, echoMix: 0.3, rvMix: 0.15,
 volume: 0.6,    },
  },
  {
    name: 'Bubble', tag: 'chip',
    values: {
      p1Duty: 3, p1Level: 0.8, p1Atk: 0.001, p1Dec: 0.12, p1Sus: 0, p1Rel: 0.1, p1PTab: 1,
      ...tab('tp', [-12, -7, -3, 0, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5]), tpLoop: 16,
      frameHz: 120, echoFrames: 20, echoFb: 8, echoMix: 0.4, echoPing: 1, rvMix: 0.3, rvSize: 0.7,
    },
  },
  {
    name: 'Laser', tag: 'chip',
    values: {
      p1Duty: 2, p1Level: 0.8, p1Oct: 1, p1Atk: 0.001, p1Dec: 0.5, p1Sus: 0, p1Rel: 0.2,
      glide: 0.25, precision: 1,
      frameHz: 240, r1Op: 1, r1Step: 1, r1Div: 1, r1Pitch: -2400, r1Mask: 255,
      nzLevel: 0.2, nzOct: 4, nzMode: 0, nzAtk: 0.001, nzDec: 0.3, nzSus: 0, nzRel: 0.1,
      echoFrames: 30, echoFb: 6, echoMix: 0.3, rvMix: 0.2,
    },
  },
  // ---- drums
  {
    name: 'Kick 8-bit', tag: 'drum',
    values: {
      p1Level: 0,
      wvLevel: 1, wvOct: -2, wvAtk: 0.001, wvDec: 0.25, wvSus: 0, wvRel: 0.15, wvPTab: 1,
      ...tab('tp', [24, 12, 7, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 120, nzLevel: 0.3, nzOct: 3, nzAtk: 0.001, nzDec: 0.03, nzSus: 0, nzRel: 0.02,
      lkSpeaker: 0.3, rvMix: 0.05,
    },
  },
  {
    name: 'Snare Noise', tag: 'drum',
    values: {
      p1Level: 0,
      nzLevel: 0.9, nzOct: 2, nzMode: 1, nzEnv: 1, nzRel: 0.04,
      ...tab('tvA', [15, 13, 11, 9, 7, 6, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0]),
      wvLevel: 0.6, wvOct: -1, wvAtk: 0.001, wvDec: 0.08, wvSus: 0, wvRel: 0.05, wvPTab: 1,
      ...tab('tp', [12, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      frameHz: 120, lkBits: 9, rvMix: 0.3, rvGate: 0.3, rvTone: 0.8, rvDecay: 2,
    },
  },
  {
    name: 'Glitch Kit', tag: 'drum',
    values: {
      p1Level: 0,
      nzLevel: 0.8, nzOct: 1, nzMode: 0, nzEnv: 2, nzRel: 0.03,
      ...tab('tvB', [15, 0, 8, 0, 15, 0, 4, 0, 15, 0, 12, 0, 6, 0, 2, 0]), tvBLoop: 16,
      pdLevel: 0.6, pdShape: 4, pdAmt: 0.9, pdOct: -1, pdAtk: 0.001, pdDec: 0.15, pdSus: 0, pdRel: 0.05,
      frameHz: 240, tabDiv: 1,
      lkBer: 0.6, lkLoss: 0.3, lkFrame: 4, lkConceal: 1, rvMix: 0.15, rvGate: 0.15,
    },
  },
  {
    name: 'Tom Divider', tag: 'drum',
    values: {
      p1Duty: 3, p1Oct: -1, p1Level: 0.9, p1Atk: 0.001, p1Dec: 0.35, p1Sus: 0, p1Rel: 0.2, p1PTab: 1,
      ...tab('tp', [7, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 90, clock: 2, lkSpeaker: 0.4, rvMix: 0.25, rvDecay: 1,
    },
  },
  // ---- pads
  {
    name: 'Neon Choir', tag: 'pad',
    values: {
      mode: 1, cycle: 0.6, clock: 5,
      p1Duty: 1, p1Level: 0.35, p1Atk: 0.8, p1Dec: 1, p1Sus: 0.9, p1Rel: 1.8, p1Pan: -0.5,
      p2Duty: 1, p2Level: 0.35, p2Fine: 9, p2Atk: 0.8, p2Sus: 0.9, p2Rel: 1.8, p2Pan: 0.5,
      wvLevel: 0.5, wvOct: -1, wvAtk: 1.2, wvSus: 0.9, wvRel: 2, ...tab('wv', SINE32),
      frameHz: 50, r1Op: 0, r1Step: 10, r1Div: 1, r1Pitch: 8, r2Op: 2, r2Step: 0b00001111, r2Div: 3, r2Duty: 0.35,
      fMode: 1, cutoff: 2600, res: 0.1,
      lkCodec: 0.5, lkKbps: 48, rvMix: 0.5, rvSize: 0.9, rvDecay: 4.5, rvTone: 0.5,
 volume: 0.55,    },
  },
  {
    name: 'Hologram', tag: 'pad',
    values: {
      mode: 1, cycle: 0.3, clock: 7,
      p1Level: 0,
      fmLevel: 0.5, fmRatio: 1, fmIndex: 0.18, fmFb: 0.2, fmEnvAmt: 0.4, fmAtk: 1.5, fmDec: 2, fmSus: 0.8, fmRel: 3, fmPan: -0.5,
      pdLevel: 0.5, pdShape: 3, pdAmt: 0.25, pdEnvAmt: 0.5, pdAtk: 2, pdSus: 0.8, pdRel: 3, pdPan: 0.5, pdOct: 1,
      frameHz: 20, r1Op: 4, r1Step: 91, r1Div: 2, r1Pitch: 6, r1Level: 0.2,
      caRule: 90, caDiv: 2, caCut: 0.4, fMode: 1, cutoff: 3000, res: 0.2,
      lkJitter: 0.35, lkDrift: 0.4, rvMix: 0.55, rvSize: 1, rvDecay: 6, rvTone: 0.6,
 volume: 0.5,    },
  },
  {
    name: 'Cold Storage', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 4,
      p1Level: 0,
      wvLevel: 0.7, wvAtk: 2.5, wvDec: 2, wvSus: 0.9, wvRel: 4, ...tab('wv', ORGAN32),
      nzLevel: 0.06, nzOct: 4, nzMode: 1, nzAtk: 3, nzSus: 1, nzRel: 4,
      frameHz: 12, r1Op: 0, r1Step: 6, r1Div: 1, r1Pitch: 5,
      fMode: 1, cutoff: 1400, res: 0.3, r2Op: 0, r2Step: 3, r2Div: 1, r2Cut: 0.3,
      lkCodec: 0.8, lkKbps: 20, lkBits: 12, lkDither: 2, rvMix: 0.6, rvSize: 1, rvDecay: 8, rvTone: 0.3, volume: 0.65,
    },
  },
  {
    name: 'Server Room', tag: 'pad',
    values: {
      mode: 1, cycle: 0.2, clock: 6,
      p1Duty: 4, p1Width: 0.18, p1Level: 0.4, p1Atk: 1, p1Sus: 0.9, p1Rel: 2, p1Oct: -1,
      p2Duty: 4, p2Width: 0.2, p2Level: 0.4, p2Xor: 1, p2Semi: 7, p2Atk: 1, p2Sus: 0.9, p2Rel: 2, p2Oct: -1,
      frameHz: 30, r1Op: 0, r1Step: 4, r1Div: 1, r1Duty: 0.6, r2Op: 0, r2Step: 7, r2Div: 1, r2Pitch: 4,
      fMode: 1, cutoff: 1800, res: 0.25, caRule: 30, caDiv: 4, caCut: 0.5,
      lkBits: 11, rvMix: 0.5, rvSize: 0.8, rvDecay: 5, rvTone: 0.4,
 volume: 0.55,    },
  },
  // ---- glass keys and bells
  {
    name: 'DX Keys', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      fmLevel: 0.85, fmRatio: 1, fmIndex: 0.35, fmFb: 0, fmEnvAmt: 0.85, fmAtk: 0.001, fmDec: 1.2, fmSus: 0.3, fmRel: 0.6,
      pdLevel: 0.3, pdShape: 0, pdAmt: 0.2, pdEnvAmt: 1, pdOct: 1, pdAtk: 0.001, pdDec: 0.4, pdSus: 0, pdRel: 0.4, pdPan: 0.3,
      vel: 0.8, rvMix: 0.25, rvSize: 0.6, rvDecay: 1.8, rvTone: 0.7,
    },
  },
  {
    name: 'Glass Marimba', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      fmLevel: 0.9, fmRatio: 4, fmIndex: 0.3, fmEnvAmt: 1, fmAtk: 0.001, fmDec: 0.35, fmSus: 0, fmRel: 0.35,
      wvLevel: 0.4, wvAtk: 0.001, wvDec: 0.2, wvSus: 0, wvRel: 0.2, ...tab('wv', SINE32),
      vel: 0.9, echoFrames: 9, echoFb: 5, echoMix: 0.3, echoPing: 1, rvMix: 0.3, rvDecay: 1.4, rvTone: 0.9,
    },
  },
  {
    name: 'Tubular', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      fmLevel: 0.8, fmRatio: 1.41, fmIndex: 0.5, fmFb: 0.15, fmEnvAmt: 0.7, fmAtk: 0.001, fmDec: 2.5, fmSus: 0, fmRel: 2.5,
      pdLevel: 0.35, pdShape: 5, pdAmt: 0.35, pdEnvAmt: 0.8, pdOct: 1, pdAtk: 0.001, pdDec: 1.5, pdSus: 0, pdRel: 1.5, pdPan: -0.4,
      lkJitter: 0.12, rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.8,
 volume: 0.55,    },
  },
  {
    name: 'CZ Brass', tag: 'glass',
    values: {
      mode: 1, cycle: 0.2, clock: 6,
      p1Level: 0,
      pdLevel: 0.9, pdShape: 0, pdAmt: 0.85, pdEnvAmt: 0.7, pdAtk: 0.04, pdDec: 0.5, pdSus: 0.6, pdRel: 0.3,
      fmLevel: 0.3, fmRatio: 0.5, fmIndex: 0.1, fmAtk: 0.04, fmSus: 0.7, fmRel: 0.3, fmPan: 0.5,
      frameHz: 40, r1Op: 0, r1Step: 8, r1Div: 1, r1Pitch: 7,
      echoFrames: 8, echoFb: 4, echoMix: 0.25, echoPing: 1, rvMix: 0.3, rvDecay: 1.6,
    },
  },
  {
    name: 'Ice Piano', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      pdLevel: 0.8, pdShape: 4, pdAmt: 0.25, pdEnvAmt: 1, pdAtk: 0.001, pdDec: 1.4, pdSus: 0.1, pdRel: 0.8,
      fmLevel: 0.45, fmRatio: 7, fmIndex: 0.12, fmEnvAmt: 1, fmAtk: 0.001, fmDec: 0.25, fmSus: 0, fmRel: 0.25, fmPan: 0.4,
      vel: 0.9, lkBits: 13, lkDither: 1, rvMix: 0.35, rvSize: 0.8, rvDecay: 2.5, rvTone: 0.75,
    },
  },
  // ---- the link
  {
    name: 'Dropout', tag: 'link',
    values: {
      mode: 1, cycle: 0,
      p1Level: 0,
      wvLevel: 0.8, wvAtk: 0.05, wvSus: 0.9, wvRel: 0.6, ...tab('wv', ORGAN32),
      pdLevel: 0.4, pdShape: 1, pdAmt: 0.5, pdOct: 1, pdAtk: 0.05, pdSus: 0.8, pdRel: 0.6, pdPan: 0.5,
      lkLoss: 0.55, lkFrame: 16, lkConceal: 0, lkDrift: 0.2, rvMix: 0.4, rvDecay: 3,
 volume: 0.6,    },
  },
  {
    name: 'Stutter Choir', tag: 'link',
    values: {
      mode: 1, cycle: 0.4, clock: 5,
      p1Duty: 1, p1Level: 0.4, p1Atk: 0.3, p1Sus: 0.9, p1Rel: 1, p1Pan: -0.6,
      p2Duty: 1, p2Level: 0.4, p2Fine: 7, p2Atk: 0.3, p2Sus: 0.9, p2Rel: 1, p2Pan: 0.6,
      wvLevel: 0.5, wvOct: -1, wvAtk: 0.4, wvSus: 0.9, wvRel: 1, ...tab('wv', SINE32),
      lkLoss: 0.7, lkFrame: 5, lkConceal: 1, lkCodec: 0.6, lkKbps: 24, rvMix: 0.45, rvSize: 0.9, rvDecay: 4,
 volume: 0.5,    },
  },
  {
    name: 'Dial-up', tag: 'link',
    values: {
      p1Level: 0,
      fmLevel: 0.9, fmRatio: 5.5, fmIndex: 0.7, fmFb: 0.4, fmEnvAmt: 0, fmAtk: 0.01, fmSus: 1, fmRel: 0.05,
      frameHz: 30, r1Op: 4, r1Step: 113, r1Div: 1, r1Pitch: 900, r2Op: 3, r2Step: 29, r2Mask: 0b10110101, r2Div: 2, r2Level: 0.5,
      lkBits: 8, lkBer: 0.4, lkSpeaker: 0.8, rvMix: 0.05,
    },
  },
  {
    name: 'Static Field', tag: 'link',
    values: {
      mode: 1,
      p1Level: 0,
      nzLevel: 0.5, nzOct: 4, nzMode: 1, nzAtk: 2, nzSus: 1, nzRel: 3,
      wvLevel: 0.5, wvOct: -1, wvAtk: 2, wvSus: 1, wvRel: 3, ...tab('wv', SINE32),
      fMode: 2, cutoff: 900, res: 0.6, frameHz: 16, r1Op: 0, r1Step: 5, r1Div: 1, r1Cut: 0.8,
      lkBer: 0.5, lkJitter: 0.5, lkDrift: 0.6, lkBits: 9, lkDither: 1, rvMix: 0.6, rvSize: 1, rvDecay: 7, rvTone: 0.3,
 volume: 0.55,    },
  },
  {
    name: 'Ghost Signal', tag: 'link',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      fmLevel: 0.7, fmRatio: 2, fmIndex: 0.2, fmFb: 0.1, fmAtk: 0.5, fmDec: 2, fmSus: 0.7, fmRel: 2.5,
      pdLevel: 0.4, pdShape: 3, pdAmt: 0.3, pdOct: -1, pdAtk: 0.8, pdSus: 0.8, pdRel: 2.5, pdPan: -0.5,
      lkJitter: 1, lkCodec: 0.9, lkKbps: 12, lkLoss: 0.15, lkFrame: 20, lkConceal: 3, rvMix: 0.5, rvSize: 1, rvDecay: 5,
 volume: 0.45,    },
  },
  // ---- sequences
  {
    name: 'Rule 30 Bass', tag: 'seq',
    values: {
      clock: 4,
      p1Duty: 2, p1Oct: -1, p1Level: 0.8, p1Env: 1, p1Rel: 0.03,
      ...tab('tvA', [15, 13, 10, 7, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
      frameHz: 120, frameSync: 1, tempo: 124,
      arpMode: 5, arpDiv: 6, arpOct: 1, arpGate: 0.6,
      caRule: 30, caDiv: 6, caPitch: 12, caCut: 0.5, fMode: 1, cutoff: 900, res: 0.5,
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1, rvMix: 0.15,
    },
  },
  {
    name: 'Trance Gate', tag: 'seq',
    values: {
      mode: 1, cycle: 0.5,
      p1Duty: 1, p1Level: 0.45, p1Env: 2, p1Rel: 0.03, p1Pan: -0.5,
      p2Duty: 1, p2Level: 0.45, p2Env: 2, p2Fine: 8, p2Rel: 0.03, p2Pan: 0.5,
      ...tab('tvB', [15, 15, 0, 0, 15, 0, 15, 15, 0, 15, 0, 0, 15, 15, 0, 15]), tvBLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 138, tabDiv: 3,
      fMode: 1, cutoff: 2200, res: 0.3, r1Op: 0, r1Step: 3, r1Div: 3, r1Cut: 0.4,
      echoFrames: 18, echoFb: 6, echoMix: 0.35, echoPing: 1, rvMix: 0.3, rvDecay: 2,
 volume: 0.6,    },
  },
  {
    name: 'XOR Sequence', tag: 'seq',
    values: {
      p1Duty: 2, p1Level: 0.7, p1Env: 1, p1Rel: 0.05,
      p2Duty: 2, p2Level: 0.7, p2Xor: 1, p2Env: 1, p2Rel: 0.05,
      ...tab('tvA', [15, 11, 8, 6, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
      frameHz: 120, frameSync: 1, tempo: 110,
      arpMode: 3, arpDiv: 6, arpOct: 2, arpGate: 0.5,
      r2Op: 3, r2Step: 41, r2Mask: 0b00111100, r2Div: 6, r2Pitch: 0,
      caRule: 110, caDiv: 12, caPitch: 5,
      echoFrames: 9, echoFb: 8, echoMix: 0.4, echoPing: 1, lkBits: 10, rvMix: 0.2,
    },
  },
  {
    name: 'Automaton Bells', tag: 'seq',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      fmLevel: 0.8, fmRatio: 3, fmIndex: 0.4, fmEnvAmt: 1, fmAtk: 0.001, fmDec: 0.5, fmSus: 0, fmRel: 0.5,
      frameHz: 120, frameSync: 1, tempo: 96,
      arpMode: 4, arpDiv: 12, arpOct: 2, arpGate: 0.3,
      caRule: 90, caDiv: 12, caPitch: 7, caLevel: 0.5,
      echoFrames: 36, echoFb: 9, echoMix: 0.4, echoPing: 1, rvMix: 0.5, rvSize: 0.9, rvDecay: 4, rvTone: 0.8,
    },
  },
  {
    name: 'Data Runner', tag: 'seq',
    values: {
      clock: 5,
      p1Duty: 0, p1Level: 0.8, p1Env: 1, p1Rel: 0.03,
      ...tab('tvA', [15, 8, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      wvLevel: 0.6, wvOct: -1, wvEnv: 1, wvRel: 0.03,
      frameHz: 120, frameSync: 1, tempo: 150,
      arpMode: 1, arpDiv: 3, arpOct: 3, arpGate: 0.5,
      r1Op: 2, r1Step: 0b10010010, r1Div: 3, r1Level: 0.5,
      lkLoss: 0.12, lkFrame: 6, lkConceal: 1, echoFrames: 9, echoFb: 6, echoMix: 0.3, echoPing: 1, rvMix: 0.2,
    },
  },
  // ---- arps (the note arp, no latch)
  {
    name: 'Crystal Run', tag: 'arp',
    values: {
      p1Duty: 0, p1Level: 0.8, p1Env: 1, p1Rel: 0.03, p1PTab: 1,
      ...tab('tvA', [15, 13, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0]),
      ...tab('tp', [12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      wvLevel: 0.45, wvOct: -1, wvEnv: 1, wvRel: 0.03, ...tab('wv', SINE32),
      frameHz: 120, frameSync: 1, tempo: 128, arpMode: 3, arpDiv: 6, arpOct: 2, arpGate: 0.7,
      echoFrames: 9, echoFb: 7, echoMix: 0.4, echoPing: 1, rvMix: 0.3, rvSize: 0.8, rvDecay: 2.5, rvTone: 0.8,
    },
  },
  {
    name: 'Stairway', tag: 'arp',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      wvLevel: 0.8, wvAtk: 0.002, wvDec: 0.6, wvSus: 0.2, wvRel: 0.5, ...tab('wv', SINE32),
      pdLevel: 0.35, pdShape: 0, pdAmt: 0.3, pdEnvAmt: 1, pdOct: 1, pdAtk: 0.002, pdDec: 0.3, pdSus: 0, pdRel: 0.3, pdPan: 0.4,
      frameHz: 120, frameSync: 1, tempo: 100, arpMode: 1, arpDiv: 12, arpOct: 3, arpGate: 0.9,
      echoFrames: 36, echoFb: 8, echoMix: 0.4, echoPing: 1, rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.7,
    },
  },
  {
    name: 'Cascade Bells', tag: 'arp',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      fmLevel: 0.8, fmRatio: 3, fmIndex: 0.45, fmEnvAmt: 1, fmAtk: 0.001, fmDec: 0.8, fmSus: 0, fmRel: 0.8,
      frameHz: 120, frameSync: 1, tempo: 112, arpMode: 4, arpDiv: 6, arpOct: 3, arpGate: 0.5,
      echoFrames: 18, echoFb: 9, echoMix: 0.45, echoPing: 1, lkJitter: 0.1, rvMix: 0.5, rvSize: 1, rvDecay: 5, rvTone: 0.85,
    },
  },
  {
    name: 'Neon Stepper', tag: 'arp',
    values: {
      clock: 5,
      p1Duty: 2, p1Level: 0.6, p1Env: 1, p1Rel: 0.03,
      p2Duty: 2, p2Level: 0.6, p2Xor: 1, p2Semi: 7, p2Env: 1, p2Rel: 0.03, p2Pan: 0.5,
      ...tab('tvA', [15, 12, 9, 7, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0]),
      frameHz: 120, frameSync: 1, tempo: 126, arpMode: 1, arpDiv: 6, arpOct: 2, arpGate: 0.6,
      fMode: 1, cutoff: 1600, res: 0.45, r1Op: 0, r1Step: 5, r1Div: 3, r1Cut: 0.6,
      echoFrames: 9, echoFb: 6, echoMix: 0.35, echoPing: 1, rvMix: 0.2, rvDecay: 1.5,
    },
  },
  {
    name: 'Rain Arp', tag: 'arp',
    values: {
      mode: 1, cycle: 0.3, clock: 6,
      p1Level: 0,
      pdLevel: 0.75, pdShape: 3, pdAmt: 0.4, pdEnvAmt: 0.9, pdAtk: 0.001, pdDec: 0.4, pdSus: 0, pdRel: 0.5,
      wvLevel: 0.4, wvOct: -1, wvAtk: 0.001, wvDec: 0.3, wvSus: 0, wvRel: 0.3, ...tab('wv', SINE32), wvPan: -0.4,
      frameHz: 120, frameSync: 1, tempo: 90, arpMode: 3, arpDiv: 4, arpOct: 2, arpGate: 0.5,
      lkLoss: 0.12, lkFrame: 10, lkConceal: 1, echoFrames: 24, echoFb: 8, echoMix: 0.35, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 5, rvTone: 0.6,
    },
  },
  {
    name: 'Broken Arp', tag: 'arp',
    values: {
      clock: 3,
      p1Duty: 4, p1Width: 0.3, p1Level: 0.8, p1Env: 1, p1Rel: 0.02,
      ...tab('tvA', [15, 15, 9, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      nzLevel: 0.25, nzOct: 3, nzMode: 0, nzEnv: 1, nzPan: 0.5,
      frameHz: 120, frameSync: 1, tempo: 140, arpMode: 4, arpDiv: 3, arpOct: 2, arpGate: 0.5,
      r1Op: 4, r1Step: 45, r1Div: 3, r1Duty: 0.5, r2Op: 2, r2Step: 0b10001000, r2Div: 6, r2Pitch: 300,
      lkLoss: 0.25, lkFrame: 6, lkConceal: 1, lkBits: 8, echoFrames: 9, echoFb: 7, echoMix: 0.3, rvMix: 0.15, rvGate: 0.2,
    },
  },
  {
    name: 'Choir Arp', tag: 'arp',
    values: {
      mode: 1, cycle: 0.5, clock: 5,
      p1Duty: 1, p1Level: 0.5, p1Atk: 0.01, p1Dec: 0.4, p1Sus: 0.5, p1Rel: 0.8, p1Pan: -0.5,
      p2Duty: 1, p2Level: 0.5, p2Fine: 8, p2Atk: 0.01, p2Dec: 0.4, p2Sus: 0.5, p2Rel: 0.8, p2Pan: 0.5,
      frameHz: 120, frameSync: 1, tempo: 118, arpMode: 1, arpDiv: 12, arpOct: 2, arpGate: 1,
      chord: 3, chordSpeed: 1,
      fMode: 1, cutoff: 2400, res: 0.15, lkCodec: 0.5, lkKbps: 40,
      echoFrames: 18, echoFb: 6, echoMix: 0.3, echoPing: 1, rvMix: 0.5, rvSize: 0.9, rvDecay: 4, volume: 0.6,
    },
  },
  // ---- tracker leads: the tables do the arpeggio
  {
    name: 'Tracker Arp', tag: 'tracker',
    values: {
      p1Duty: 1, p1Level: 0.8, p1Env: 2, p1Rel: 0.05, p1PTab: 1,
      ...tab('tvB', [15, 15, 14, 14, 13, 13, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12]), tvBLoop: 16,
      ...tab('tp', [0, 4, 7, 12, 0, 4, 7, 12, 0, 4, 7, 12, 0, 4, 7, 12]), tpLoop: 0,
      frameHz: 60, r1Op: 0, r1Step: 40, r1Div: 1, r1Pitch: 20,
      echoFrames: 12, echoFb: 7, echoMix: 0.4, echoPing: 1, rvMix: 0.2, rvDecay: 1.5,
    },
  },
  {
    name: 'Round Lead', tag: 'tracker',
    values: {
      precision: 0.3,
      p1Duty: 2, p1Level: 0.45, p1Env: 2, p1Rel: 0.15, p1PTab: 1,
      wvLevel: 0.8, wvEnv: 2, wvRel: 0.15, wvPTab: 1, ...tab('wv', SINE32),
      ...tab('tvB', [6, 9, 12, 14, 15, 15, 14, 14, 13, 13, 13, 12, 12, 12, 12, 12]), tvBLoop: 16,
      ...tab('tp', [12, 12, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 60, r1Op: 0, r1Step: 20, r1Div: 2, r1Pitch: 14,
      echoFrames: 20, echoFb: 7, echoMix: 0.35, echoPing: 1, rvMix: 0.35, rvSize: 0.8, rvDecay: 2.5, rvTone: 0.6,
    },
  },
  {
    name: 'Warm Square', tag: 'tracker',
    values: {
      clock: 5, precision: 0.2,
      p1Duty: 2, p1Level: 0.6, p1Env: 2, p1Rel: 0.3,
      wvLevel: 0.7, wvOct: -1, wvEnv: 2, wvRel: 0.3, ...tab('wv', SINE32),
      ...tab('tvB', [4, 8, 11, 13, 15, 15, 15, 14, 14, 13, 13, 12, 12, 12, 12, 12]), tvBLoop: 16,
      frameHz: 50, tabDiv: 2, r1Op: 0, r1Step: 14, r1Div: 2, r1Pitch: 10,
      fMode: 1, cutoff: 3200, res: 0.1, echoFrames: 15, echoFb: 6, echoMix: 0.3, echoPing: 1,
      rvMix: 0.4, rvSize: 0.9, rvDecay: 3, rvTone: 0.5,
    },
  },
  {
    name: 'Tracker Bell', tag: 'tracker',
    values: {
      p1Duty: 0, p1Level: 0.6, p1Env: 1, p1Rel: 0.05, p1PTab: 1, p1Oct: 1,
      fmLevel: 0.7, fmRatio: 4, fmIndex: 0.35, fmEnvAmt: 1, fmAtk: 0.001, fmDec: 0.6, fmSus: 0, fmRel: 0.6, fmPTab: 1,
      ...tab('tvA', [15, 12, 9, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1, 1, 0, 0]),
      ...tab('tp', [12, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 60, echoFrames: 18, echoFb: 8, echoMix: 0.4, echoPing: 1, rvMix: 0.4, rvSize: 0.9, rvDecay: 3, rvTone: 0.85,
    },
  },
  {
    name: 'Sweep Lead', tag: 'tracker',
    values: {
      p1Duty: 4, p1Width: 0.5, p1Level: 0.8, p1Env: 2, p1Rel: 0.08, p1PTab: 1,
      p2Duty: 4, p2Width: 0.5, p2Level: 0.5, p2Oct: -1, p2Env: 2, p2Rel: 0.08, p2Pan: 0.4,
      ...tab('tvB', [15, 15, 15, 14, 13, 12, 11, 11, 10, 10, 10, 10, 10, 10, 10, 10]), tvBLoop: 16,
      ...tab('tp', [-12, -9, -7, -5, -3, -2, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 60, r1Op: 2, r1Step: 0b00000111, r1Div: 1, r1Duty: 0.5, r2Op: 0, r2Step: 24, r2Div: 1, r2Pitch: 12,
      echoFrames: 9, echoFb: 5, echoMix: 0.3, echoPing: 1, rvMix: 0.2,
    },
  },
  {
    name: 'Minor Third Lead', tag: 'tracker',
    values: {
      p1Duty: 1, p1Level: 0.8, p1Env: 2, p1Rel: 0.06, p1PTab: 1,
      wvLevel: 0.5, wvOct: -1, wvEnv: 2, wvRel: 0.06,
      ...tab('tvB', [15, 14, 13, 12, 12, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11]), tvBLoop: 16,
      ...tab('tp', [0, 3, 7, 3, 0, 3, 7, 3, 0, 3, 7, 3, 0, 3, 7, 3]), tpLoop: 0,
      frameHz: 60, tabDiv: 2, r1Op: 0, r1Step: 30, r1Div: 1, r1Pitch: 15,
      lkSpeaker: 0.3, echoFrames: 16, echoFb: 7, echoMix: 0.35, echoPing: 1, rvMix: 0.25, rvDecay: 1.8,
    },
  },
  {
    name: 'Octave Bounce', tag: 'tracker',
    values: {
      clock: 4,
      p1Duty: 2, p1Level: 0.8, p1Env: 1, p1Rel: 0.04, p1PTab: 1,
      ...tab('tvA', [15, 14, 12, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0]),
      ...tab('tp', [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12]), tpLoop: 0,
      nzLevel: 0.15, nzOct: 4, nzMode: 0, nzEnv: 1,
      frameHz: 60, echoFrames: 6, echoFb: 6, echoMix: 0.3, echoPing: 1, rvMix: 0.2,
    },
  },
  // ---- weird
  {
    name: 'Bitwise', tag: 'weird',
    values: {
      clock: 2,
      p1Duty: 0, p1Level: 0.8, p1Env: 1, p1Rel: 0.03,
      ...tab('tvA', [15, 15, 12, 12, 8, 8, 4, 4, 2, 2, 1, 1, 0, 0, 0, 0]),
      frameHz: 60, r1Op: 3, r1Step: 3, r1Mask: 0b10010001, r1Div: 1, r1Pitch: 1200,
      r2Op: 4, r2Step: 201, r2Div: 2, r2Duty: 0.8, r2Level: 0.4,
      echoFrames: 7, echoFb: 9, echoMix: 0.4, echoPing: 1, lkBits: 6, rvMix: 0.15, rvGate: 0.3,
    },
  },
  {
    name: 'Modem Choir', tag: 'weird',
    values: {
      mode: 1, cycle: 0.6, clock: 5,
      p1Level: 0,
      fmLevel: 0.6, fmRatio: 2, fmIndex: 0.25, fmFb: 0.3, fmAtk: 0.6, fmSus: 0.9, fmRel: 1.5, fmPan: -0.5,
      wvLevel: 0.6, wvAtk: 0.6, wvSus: 0.9, wvRel: 1.5, wvPan: 0.5, ...tab('wv', ORGAN32),
      frameHz: 24, caRule: 30, caDiv: 1, caLevel: 0.5, caDuty: 0.4,
      lkCodec: 1, lkKbps: 8, lkBer: 0.3, rvMix: 0.4, rvSize: 0.8, rvDecay: 3, volume: 0.6,
    },
  },
  {
    name: 'Time Slip', tag: 'weird',
    values: {
      mode: 1, cycle: 0, clock: 7,
      p1Level: 0,
      pdLevel: 0.8, pdShape: 5, pdAmt: 0.5, pdEnvAmt: 0.6, pdAtk: 0.3, pdDec: 1, pdSus: 0.7, pdRel: 2,
      fmLevel: 0.4, fmRatio: 0.5, fmIndex: 0.15, fmAtk: 0.3, fmSus: 0.7, fmRel: 2, fmPan: 0.5,
      lkDrift: 1, lkJitter: 0.4, lkLoss: 0.35, lkFrame: 20, lkConceal: 3,
      echoFrames: 30, echoFb: 8, echoMix: 0.35, echoPing: 1, rvMix: 0.5, rvSize: 1, rvDecay: 6, rvTone: 0.4, volume: 0.6,
    },
  },
  {
    name: 'Fractal', tag: 'weird',
    values: {
      clock: 4,
      p1Duty: 0, p1Level: 0.8, p1Env: 1, p1Rel: 0.02,
      ...tab('tvA', [15, 10, 6, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      frameHz: 120, frameSync: 1, tempo: 132, arpMode: 5, arpDiv: 3, arpOct: 1, arpGate: 0.5,
      caRule: 90, caDiv: 3, caPitch: 24, caLevel: 0.3,
      echoFrames: 9, echoFb: 8, echoMix: 0.4, echoPing: 1, lkBits: 10, rvMix: 0.25, rvDecay: 1.5,
    },
  },
  {
    name: 'Whale', tag: 'weird',
    values: {
      mode: 1, cycle: 0, clock: 7, glide: 0.08,
      p1Level: 0,
      wvLevel: 0.9, wvOct: -1, wvAtk: 1.5, wvDec: 2, wvSus: 0.8, wvRel: 3, ...tab('wv', SINE32),
      pdLevel: 0.3, pdShape: 4, pdAmt: 0.15, pdEnvAmt: 0.8, pdAtk: 2, pdSus: 0.7, pdRel: 3, pdOct: -1,
      frameHz: 30, r1Op: 0, r1Step: 3, r1Div: 1, r1Pitch: 30,
      lkDrift: 0.7, lkCodec: 0.4, lkKbps: 24, echoFrames: 32, echoFb: 9, echoMix: 0.3, echoPing: 1,
      rvMix: 0.6, rvSize: 1, rvDecay: 8, rvTone: 0.3, volume: 0.6,
    },
  },
  {
    name: 'Clockwork', tag: 'weird',
    values: {
      clock: 6, precision: 1,
      p1Duty: 3, p1Level: 0.6, p1Env: 1, p1Rel: 0.01, p1PTab: 1,
      nzLevel: 0.5, nzOct: 3, nzMode: 0, nzEnv: 1, nzPan: 0.6,
      ...tab('tvA', [15, 6, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...tab('tp', [0, 7, 12, 19, 24, 19, 12, 7, 0, -5, -12, -5, 0, 7, 12, 7]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 120, tabDiv: 3,
      r2Op: 1, r2Step: 32, r2Div: 12, r2Cut: 0.8, fMode: 2, cutoff: 1200, res: 0.6,
      echoFrames: 18, echoFb: 9, echoMix: 0.45, echoPing: 1, rvMix: 0.3, rvDecay: 2, rvGate: 0.4,
    },
  },
  {
    name: 'Neural Drone', tag: 'weird',
    values: {
      mode: 1, cycle: 0.8, clock: 4,
      p1Duty: 4, p1Width: 0.12, p1Level: 0.4, p1Atk: 2, p1Sus: 1, p1Rel: 3, p1Pan: -0.7,
      p2Duty: 4, p2Width: 0.12, p2Level: 0.4, p2Xor: 1, p2Semi: 7, p2Fine: 3, p2Atk: 2, p2Sus: 1, p2Rel: 3, p2Pan: 0.7,
      nzLevel: 0.1, nzOct: 2, nzMode: 0, nzAtk: 3, nzSus: 1, nzRel: 3,
      frameHz: 8, r1Op: 4, r1Step: 171, r1Div: 1, r1Duty: 0.7, r1Pitch: 6,
      caRule: 110, caDiv: 1, caCut: 0.7, fMode: 1, cutoff: 900, res: 0.5,
      lkBits: 10, lkDither: 2, rvMix: 0.6, rvSize: 1, rvDecay: 9, rvTone: 0.35, volume: 0.6,
    },
  },
  // ---- rich: several channels stacked, detuned and spread (precision 1, so the detune beats
  // instead of landing on the same divider step), slow register motion, echo and plate
  {
    name: 'Nebula Stack', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.35,
      p1Duty: 4, p1Width: 0.34, p1Level: 0.34, p1Fine: -9, p1Pan: -0.75, p1Atk: 1.1, p1Dec: 2, p1Sus: 0.85, p1Rel: 2.8,
      p2Duty: 4, p2Width: 0.66, p2Level: 0.34, p2Fine: 9, p2Pan: 0.75, p2Atk: 1.1, p2Dec: 2, p2Sus: 0.85, p2Rel: 2.8,
      wvLevel: 0.5, wvOct: -1, wvFine: 4, wvAtk: 0.8, wvDec: 2, wvSus: 0.9, wvRel: 3, ...tab('wv', SOFTSAW32),
      fmLevel: 0.2, fmOct: 1, fmRatio: 1, fmIndex: 0.08, fmEnvAmt: 0, fmAtk: 2, fmSus: 1, fmRel: 3,
      frameHz: 40, r1Op: 0, r1Step: 5, r1Div: 1, r1Pitch: 7, r2Op: 0, r2Step: 3, r2Div: 1, r2Duty: 0.35,
      fMode: 1, cutoff: 3600, res: 0.12,
      lkDrift: 0.25, lkJitter: 0.08,
      echoFrames: 18, echoFb: 6, echoMix: 0.22, echoPing: 1,
      rvMix: 0.5, rvSize: 1, rvDecay: 6, rvTone: 0.55, volume: 0.55,
    },
  },
  {
    name: 'Aurora Grid', tag: 'pad',
    values: {
      mode: 1, cycle: 0.12, clock: 7, precision: 1, vel: 0.3,
      p1Level: 0,
      wvLevel: 0.55, wvFine: -6, wvPan: -0.55, wvAtk: 1.5, wvDec: 3, wvSus: 0.9, wvRel: 3.5, ...tab('wv', ORGAN32),
      pdLevel: 0.4, pdShape: 3, pdAmt: 0.35, pdEnvAmt: 0.3, pdOct: 1, pdFine: 6, pdPan: 0.55, pdAtk: 2.2, pdDec: 3, pdSus: 0.8, pdRel: 3.5,
      fmLevel: 0.35, fmOct: -1, fmRatio: 1, fmIndex: 0.14, fmFb: 0.15, fmEnvAmt: 0.2, fmAtk: 1.2, fmSus: 1, fmRel: 3,
      frameHz: 30, r1Op: 0, r1Step: 4, r1Div: 1, r1Pitch: 6, caRule: 90, caDiv: 8, caCut: 0.18,
      fMode: 1, cutoff: 4200, res: 0.18,
      lkDrift: 0.3,
      echoFrames: 24, echoFb: 7, echoMix: 0.2, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 7, rvTone: 0.6, volume: 0.52,
    },
  },
  {
    name: 'Glass Cathedral', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4,
      p1Level: 0,
      fmLevel: 0.45, fmRatio: 3.5, fmIndex: 0.12, fmEnvAmt: 0.6, fmPan: -0.4, fmAtk: 0.6, fmDec: 4, fmSus: 0.5, fmRel: 5,
      pdLevel: 0.28, pdShape: 5, pdAmt: 0.3, pdEnvAmt: 0.5, pdOct: 1, pdFine: 5, pdPan: 0.5, pdAtk: 1.5, pdDec: 3, pdSus: 0.6, pdRel: 5,
      wvLevel: 0.5, wvOct: -1, wvAtk: 1.2, wvDec: 2, wvSus: 0.95, wvRel: 5, ...tab('wv', SINE32),
      frameHz: 24, r1Op: 0, r1Step: 3, r1Div: 1, r1Pitch: 5,
      lkJitter: 0.12,
      echoFrames: 30, echoFb: 8, echoMix: 0.25, echoPing: 1,
      rvMix: 0.62, rvSize: 1, rvDecay: 9, rvTone: 0.75, volume: 0.53,
    },
  },
  {
    name: 'Crystal EP', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.85,
      p1Level: 0,
      fmLevel: 0.8, fmRatio: 1, fmIndex: 0.42, fmEnvAmt: 0.9, fmPan: -0.2, fmAtk: 0.001, fmDec: 1.8, fmSus: 0.25, fmRel: 0.7,
      pdLevel: 0.3, pdShape: 4, pdAmt: 0.35, pdEnvAmt: 1, pdOct: 1, pdFine: 4, pdPan: 0.35, pdAtk: 0.001, pdDec: 0.35, pdSus: 0, pdRel: 0.3,
      wvLevel: 0.35, wvFine: -4, wvPan: 0.2, wvAtk: 0.004, wvDec: 2.5, wvSus: 0.35, wvRel: 0.8, ...tab('wv', SINE32),
      frameHz: 60, r1Op: 0, r1Step: 26, r1Div: 1, r1Level: 0.14,
      lkDrift: 0.12,
      echoFrames: 15, echoFb: 5, echoMix: 0.18, echoPing: 1,
      rvMix: 0.3, rvSize: 0.75, rvDecay: 2.4, rvTone: 0.65, volume: 0.64,
    },
  },
  {
    name: 'Vapor Keys', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 6, precision: 1, vel: 0.7,
      p1Duty: 4, p1Width: 0.3, p1Level: 0.3, p1Fine: -7, p1Pan: -0.6, p1Atk: 0.005, p1Dec: 1.2, p1Sus: 0.45, p1Rel: 0.9,
      p2Duty: 4, p2Width: 0.7, p2Level: 0.3, p2Fine: 7, p2Pan: 0.6, p2Atk: 0.005, p2Dec: 1.2, p2Sus: 0.45, p2Rel: 0.9,
      pdLevel: 0.55, pdShape: 0, pdAmt: 0.55, pdEnvAmt: 0.8, pdAtk: 0.002, pdDec: 0.9, pdSus: 0.3, pdRel: 0.8,
      frameHz: 30, r2Op: 0, r2Step: 4, r2Div: 1, r2Duty: 0.3,
      fMode: 1, cutoff: 2800, res: 0.2,
      lkDrift: 0.35, lkBits: 12, lkDither: 2,
      echoFrames: 12, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.35, rvSize: 0.8, rvDecay: 3, rvTone: 0.5,
    },
  },
  {
    name: 'Mallet Garden', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.9,
      p1Level: 0,
      fmLevel: 0.7, fmRatio: 4, fmIndex: 0.3, fmEnvAmt: 1, fmPan: 0.3, fmAtk: 0.001, fmDec: 0.5, fmSus: 0, fmRel: 0.5,
      wvLevel: 0.6, wvOct: -1, wvAtk: 0.001, wvDec: 1.3, wvSus: 0, wvRel: 1, ...tab('wv', SINE32),
      pdLevel: 0.22, pdShape: 3, pdAmt: 0.5, pdEnvAmt: 1, pdOct: 2, pdPan: -0.45, pdAtk: 0.001, pdDec: 0.15, pdSus: 0, pdRel: 0.15,
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.4, rvSize: 0.9, rvDecay: 3.2, rvTone: 0.8,
    },
  },
  {
    name: 'Neon Brass', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Duty: 4, p1Width: 0.3, p1Level: 0.3, p1Fine: -8, p1Pan: -0.5, p1Atk: 0.06, p1Dec: 0.6, p1Sus: 0.75, p1Rel: 0.35,
      p2Duty: 4, p2Width: 0.7, p2Level: 0.3, p2Fine: 8, p2Pan: 0.5, p2Atk: 0.06, p2Dec: 0.6, p2Sus: 0.75, p2Rel: 0.35,
      pdLevel: 0.65, pdShape: 0, pdAmt: 0.9, pdEnvAmt: 0.75, pdAtk: 0.05, pdDec: 0.5, pdSus: 0.6, pdRel: 0.3,
      wvLevel: 0.3, wvOct: -1, wvAtk: 0.04, wvSus: 0.9, wvRel: 0.3, ...tab('wv', SOFTSAW32),
      frameHz: 50, r1Op: 0, r1Step: 20, r1Div: 1, r1Pitch: 7,
      fMode: 1, cutoff: 2600, res: 0.18,
      echoFrames: 10, echoFb: 4, echoMix: 0.18, echoPing: 1,
      rvMix: 0.3, rvSize: 0.7, rvDecay: 2, volume: 0.62,
    },
  },
  {
    name: 'Hyper Saw', tag: 'tracker',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3, glide: 0.6,
      p1Duty: 4, p1Width: 0.5, p1Level: 0.3, p1Fine: -13, p1Pan: -0.7, p1Sus: 0.9, p1Rel: 0.25,
      p2Duty: 4, p2Width: 0.5, p2Level: 0.3, p2Fine: 13, p2Pan: 0.7, p2Sus: 0.9, p2Rel: 0.25,
      wvLevel: 0.4, wvFine: 5, wvSus: 0.9, wvRel: 0.25, ...tab('wv', SAW32),
      pdLevel: 0.45, pdShape: 0, pdAmt: 0.85, pdEnvAmt: 0, pdOct: -1, pdSus: 0.9, pdRel: 0.25,
      frameHz: 60, r1Op: 0, r1Step: 40, r1Div: 1, r1Pitch: 12, r2Op: 0, r2Step: 6, r2Div: 1, r2Duty: 0.25,
      fMode: 1, cutoff: 5200, res: 0.15,
      echoFrames: 12, echoFb: 6, echoMix: 0.28, echoPing: 1,
      rvMix: 0.25, rvSize: 0.7, rvDecay: 2.2, volume: 0.6,
    },
  },
  {
    name: 'Vox Lead', tag: 'tracker',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4, glide: 0.35,
      p1Level: 0,
      wvLevel: 0.7, wvAtk: 0.03, wvSus: 0.9, wvRel: 0.3, wvPTab: 1, ...tab('wv', VOX32),
      fmLevel: 0.35, fmRatio: 2, fmIndex: 0.2, fmFb: 0.25, fmEnvAmt: 0.4, fmFine: 6, fmPan: 0.35, fmAtk: 0.05, fmSus: 0.8, fmRel: 0.3, fmPTab: 1,
      pdLevel: 0.25, pdShape: 5, pdAmt: 0.4, pdEnvAmt: 0.5, pdFine: -6, pdPan: -0.35, pdAtk: 0.05, pdSus: 0.8, pdRel: 0.3,
      ...tab('tp', [12, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 60, r1Op: 0, r1Step: 34, r1Div: 1, r1Pitch: 16,
      fMode: 1, cutoff: 4000, res: 0.25,
      echoFrames: 20, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.35, rvSize: 0.85, rvDecay: 3, rvTone: 0.6, volume: 0.6,
    },
  },
  {
    name: 'Sub Reactor', tag: 'bass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 1, p1Level: 0.4, p1Oct: -1, p1Fine: -6, p1Pan: -0.25, p1Atk: 0.001, p1Dec: 0.5, p1Sus: 0.6, p1Rel: 0.12,
      p2Duty: 1, p2Level: 0.4, p2Oct: -1, p2Fine: 6, p2Pan: 0.25, p2Atk: 0.001, p2Dec: 0.5, p2Sus: 0.6, p2Rel: 0.12,
      wvLevel: 0.85, wvOct: -2, wvAtk: 0.001, wvSus: 1, wvRel: 0.12, ...tab('wv', SINE32),
      pdLevel: 0.4, pdShape: 4, pdAmt: 0.45, pdEnvAmt: 1, pdOct: -1, pdAtk: 0.001, pdDec: 0.22, pdSus: 0, pdRel: 0.1,
      fMode: 1, cutoff: 1100, res: 0.35, r1Op: 0, r1Step: 2, r1Div: 1, r1Cut: 0.2, frameHz: 60,
      rvMix: 0.08, rvDecay: 0.8, volume: 0.58,
    },
  },
  {
    name: 'Reese Circuit', tag: 'bass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4,
      p1Duty: 4, p1Width: 0.5, p1Level: 0.45, p1Oct: -1, p1Fine: -14, p1Pan: -0.4, p1Atk: 0.005, p1Sus: 1, p1Rel: 0.15,
      p2Duty: 4, p2Width: 0.5, p2Level: 0.45, p2Oct: -1, p2Fine: 14, p2Pan: 0.4, p2Atk: 0.005, p2Sus: 1, p2Rel: 0.15,
      wvLevel: 0.75, wvOct: -2, wvAtk: 0.005, wvSus: 1, wvRel: 0.15, ...tab('wv', SINE32),
      frameHz: 30, r1Op: 0, r1Step: 3, r1Div: 1, r1Cut: 0.35, r2Op: 0, r2Step: 5, r2Div: 1, r2Duty: 0.3,
      fMode: 1, cutoff: 800, res: 0.3,
      lkDrift: 0.15,
      rvMix: 0.1, rvDecay: 1, volume: 0.5,
    },
  },
  {
    name: 'FM Punch Bass', tag: 'bass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.7,
      p1Level: 0,
      fmLevel: 0.8, fmOct: -1, fmRatio: 1, fmIndex: 0.5, fmFb: 0.2, fmEnvAmt: 0.85, fmAtk: 0.001, fmDec: 0.35, fmSus: 0.45, fmRel: 0.1,
      wvLevel: 0.6, wvOct: -2, wvAtk: 0.001, wvSus: 1, wvRel: 0.1, ...tab('wv', HOLLOW32),
      nzLevel: 0.12, nzOct: 3, nzMode: 1, nzAtk: 0.001, nzDec: 0.03, nzSus: 0, nzRel: 0.02,
      fMode: 1, cutoff: 2200, res: 0.2,
      rvMix: 0.06, rvDecay: 0.6,
    },
  },
  {
    name: 'Prism Arp', tag: 'arp',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Level: 0,
      pdLevel: 0.6, pdShape: 3, pdAmt: 0.45, pdEnvAmt: 0.9, pdPan: -0.35, pdAtk: 0.001, pdDec: 0.35, pdSus: 0.1, pdRel: 0.4,
      fmLevel: 0.45, fmRatio: 2, fmIndex: 0.3, fmEnvAmt: 1, fmFine: 7, fmPan: 0.4, fmAtk: 0.001, fmDec: 0.5, fmSus: 0, fmRel: 0.5,
      wvLevel: 0.45, wvOct: -1, wvAtk: 0.001, wvDec: 0.6, wvSus: 0.2, wvRel: 0.4, ...tab('wv', SOFTSAW32),
      frameHz: 120, frameSync: 1, tempo: 118, arpMode: 3, arpDiv: 6, arpOct: 2, arpGate: 0.7,
      fMode: 1, cutoff: 3000, res: 0.3, r1Op: 0, r1Step: 3, r1Div: 3, r1Cut: 0.4,
      echoFrames: 18, echoFb: 8, echoMix: 0.35, echoPing: 1,
      rvMix: 0.4, rvSize: 0.9, rvDecay: 3.5, rvTone: 0.7,
    },
  },
  {
    name: 'Stardust', tag: 'seq',
    values: {
      mode: 1, cycle: 0.2, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      fmLevel: 0.55, fmRatio: 3, fmIndex: 0.25, fmEnvAmt: 0.8, fmPan: -0.4, fmAtk: 0.002, fmDec: 0.8, fmSus: 0.35, fmRel: 1.2,
      wvLevel: 0.45, wvFine: 5, wvPan: 0.4, wvAtk: 0.01, wvDec: 1, wvSus: 0.5, wvRel: 1.2, ...tab('wv', HOLLOW32),
      pdLevel: 0.3, pdShape: 5, pdAmt: 0.4, pdEnvAmt: 0.6, pdOct: -1, pdAtk: 0.3, pdSus: 0.7, pdRel: 1.5,
      chord: 6, chordSpeed: 3, chordDir: 2, chordOct: 1,
      frameHz: 120, frameSync: 1, tempo: 110,
      echoFrames: 18, echoFb: 8, echoMix: 0.35, echoPing: 1,
      rvMix: 0.5, rvSize: 1, rvDecay: 5, rvTone: 0.7, volume: 0.6,
    },
  },
  {
    name: 'Arcade Orchestra', tag: 'chip',
    values: {
      clock: 5, precision: 0.5,
      p1Duty: 1, p1Level: 0.6, p1Pan: -0.3, p1Atk: 0.001, p1Dec: 0.3, p1Sus: 0.7, p1Rel: 0.15,
      p2Duty: 0, p2Level: 0.4, p2Oct: 1, p2Fine: 6, p2Pan: 0.4, p2Atk: 0.001, p2Dec: 0.3, p2Sus: 0.6, p2Rel: 0.15,
      wvLevel: 0.7, wvOct: -1, wvSus: 0.9, wvRel: 0.1,
      nzLevel: 0.1, nzOct: 4, nzMode: 0, nzEnv: 1, nzPan: 0.2,
      ...tab('tvA', [15, 9, 5, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      chord: 3, chordSpeed: 1, chordOct: 1,
      frameHz: 60, r1Op: 0, r1Step: 36, r1Div: 1, r1Pitch: 14, r2Op: 2, r2Step: 0b00111100, r2Div: 4, r2Duty: 0.25,
      echoFrames: 9, echoFb: 7, echoMix: 0.35, echoPing: 1,
      rvMix: 0.22, rvSize: 0.6, rvDecay: 1.4, volume: 0.72,
    },
  },
  {
    name: 'Lo-Fi Memory', tag: 'link',
    values: {
      mode: 1, cycle: 0, clock: 5, precision: 1, vel: 0.5,
      p1Duty: 4, p1Width: 0.4, p1Level: 0.3, p1Fine: -8, p1Pan: -0.6, p1Atk: 0.02, p1Dec: 1.5, p1Sus: 0.6, p1Rel: 1.2,
      wvLevel: 0.55, wvFine: 8, wvPan: 0.6, wvAtk: 0.02, wvDec: 1.5, wvSus: 0.6, wvRel: 1.2, ...tab('wv', ORGAN32),
      fmLevel: 0.4, fmRatio: 1, fmIndex: 0.3, fmEnvAmt: 0.8, fmAtk: 0.002, fmDec: 1.2, fmSus: 0.3, fmRel: 1,
      frameHz: 20, r1Op: 0, r1Step: 3, r1Div: 1, r1Pitch: 14,
      fMode: 1, cutoff: 2400, res: 0.1,
      lkDrift: 0.6, lkCodec: 0.45, lkKbps: 40, lkBits: 11, lkDither: 2,
      echoFrames: 15, echoFb: 7, echoMix: 0.25, echoPing: 1,
      rvMix: 0.4, rvSize: 0.8, rvDecay: 3, rvTone: 0.4, volume: 0.64,
    },
  },
  {
    name: 'Orbital Drone', tag: 'weird',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.2,
      p1Duty: 4, p1Width: 0.25, p1Level: 0.3, p1Oct: -1, p1Fine: -5, p1Pan: -0.7, p1Atk: 3, p1Sus: 1, p1Rel: 5,
      p2Duty: 4, p2Width: 0.75, p2Level: 0.3, p2Oct: -1, p2Semi: 7, p2Fine: 5, p2Pan: 0.7, p2Atk: 3, p2Sus: 1, p2Rel: 5,
      wvLevel: 0.5, wvOct: -2, wvAtk: 2, wvSus: 1, wvRel: 5, ...tab('wv', HOLLOW32),
      fmLevel: 0.25, fmRatio: 1.5, fmIndex: 0.2, fmFb: 0.3, fmEnvAmt: 0, fmOct: 1, fmAtk: 5, fmSus: 1, fmRel: 5,
      frameHz: 10, r1Op: 0, r1Step: 2, r1Div: 1, r1Duty: 0.5, r2Op: 0, r2Step: 3, r2Div: 1, r2Pitch: 5,
      caRule: 90, caDiv: 4, caCut: 0.35, fMode: 1, cutoff: 1500, res: 0.4,
      lkDrift: 0.5, lkJitter: 0.15,
      echoFrames: 32, echoFb: 9, echoMix: 0.3, echoPing: 1,
      rvMix: 0.6, rvSize: 1, rvDecay: 9, rvTone: 0.4, volume: 0.5,
    },
  },
  // ================================================================ second bank
  // After the first bank rather than among it, so the host's program numbers
  // for the sounds above stay put; the browser sorts by category anyway.
  // Almost all are modern-mode stacks at precision 1: two pulses detuned and
  // spread wide, a drawn wave in the middle, FM or PD on top, slow register
  // motion, a ping-pong frame echo and a large plate.
  //
  // The sequences use the tables as a step sequencer: frame sync on (24 frames
  // a beat) and frames/step 3 make each table step a thirty-second, so the
  // pitch table holds each note for two steps while volume table B accents
  // the first of each pair. The tables restart with every note, so a held
  // chord plays the pattern from the moment you press it.

  // ---------------------------------------------------------------------- pads
  {
    name: 'Silk Nebula', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Duty: 4, p1Width: 0.4, p1Level: 0.32, p1Fine: -11, p1Pan: -0.8, p1Atk: 1.5, p1Dec: 2, p1Sus: 0.9, p1Rel: 4,
      p2Duty: 4, p2Width: 0.6, p2Level: 0.32, p2Fine: 11, p2Pan: 0.8, p2Atk: 1.5, p2Dec: 2, p2Sus: 0.9, p2Rel: 4,
      wvLevel: 0.5, wvOct: -1, wvAtk: 1.2, wvDec: 2, wvSus: 0.9, wvRel: 4, ...tab('wv', SOFTSAW32),
      pdLevel: 0.2, pdShape: 3, pdAmt: 0.3, pdEnvAmt: 0.2, pdOct: 1, pdFine: 4, pdAtk: 2.5, pdSus: 0.9, pdRel: 4,
      frameHz: 30, r1Op: 0, r1Step: 4, r1Div: 1, r1Pitch: 6, r2Op: 0, r2Step: 3, r2Div: 1, r2Duty: 0.3,
      fMode: 1, cutoff: 3000, res: 0.12,
      lkDrift: 0.2,
      echoFrames: 24, echoFb: 7, echoMix: 0.2, echoPing: 1,
      rvMix: 0.6, rvSize: 1, rvDecay: 8, rvTone: 0.55, volume: 0.41,
    },
  },
  {
    name: 'Choir of Machines', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Duty: 1, p1Level: 0.22, p1Fine: -8, p1Pan: -0.7, p1Atk: 1, p1Dec: 2, p1Sus: 0.85, p1Rel: 3,
      p2Duty: 1, p2Level: 0.22, p2Fine: 8, p2Pan: 0.7, p2Atk: 1, p2Dec: 2, p2Sus: 0.85, p2Rel: 3,
      wvLevel: 0.6, wvAtk: 0.9, wvDec: 2, wvSus: 0.9, wvRel: 3, ...tab('wv', CHOIR32),
      fmLevel: 0.25, fmOct: -1, fmRatio: 2, fmIndex: 0.1, fmFb: 0.1, fmEnvAmt: 0, fmAtk: 1.5, fmSus: 1, fmRel: 3,
      frameHz: 40, r1Op: 0, r1Step: 6, r1Div: 1, r1Pitch: 8, r2Op: 2, r2Step: 0b00001111, r2Div: 4, r2Duty: 0.25,
      fMode: 1, cutoff: 2800, res: 0.15,
      lkJitter: 0.08,
      echoFrames: 18, echoFb: 6, echoMix: 0.18, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 7, rvTone: 0.55, volume: 0.45,
    },
  },
  {
    name: 'Warm Signal', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Duty: 2, p1Level: 0.28, p1Oct: -1, p1Fine: -7, p1Pan: -0.6, p1Atk: 0.8, p1Dec: 2, p1Sus: 0.9, p1Rel: 2.5,
      p2Duty: 2, p2Level: 0.28, p2Oct: -1, p2Fine: 7, p2Pan: 0.6, p2Atk: 0.8, p2Dec: 2, p2Sus: 0.9, p2Rel: 2.5,
      wvLevel: 0.6, wvAtk: 0.6, wvDec: 2, wvSus: 0.9, wvRel: 2.5, ...tab('wv', HOLLOW32),
      frameHz: 24, r1Op: 0, r1Step: 3, r1Div: 1, r1Pitch: 5, r2Op: 0, r2Step: 2, r2Div: 1, r2Cut: 0.2,
      fMode: 1, cutoff: 1800, res: 0.15,
      lkDrift: 0.3,
      echoFrames: 18, echoFb: 5, echoMix: 0.15, echoPing: 1,
      rvMix: 0.5, rvSize: 0.9, rvDecay: 5, rvTone: 0.45, volume: 0.38,
    },
  },
  {
    name: 'Glacial FM', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Level: 0,
      fmLevel: 0.5, fmRatio: 1, fmIndex: 0.15, fmFb: 0.1, fmEnvAmt: 0.2, fmPan: -0.4, fmAtk: 2, fmDec: 3, fmSus: 0.85, fmRel: 5,
      pdLevel: 0.3, pdShape: 5, pdAmt: 0.3, pdEnvAmt: 0.3, pdOct: 1, pdFine: 6, pdPan: 0.5, pdAtk: 2.5, pdDec: 3, pdSus: 0.8, pdRel: 5,
      wvLevel: 0.5, wvOct: -1, wvFine: -4, wvAtk: 1.5, wvSus: 1, wvRel: 5, ...tab('wv', SINE32),
      frameHz: 20, r1Op: 0, r1Step: 3, r1Div: 1, r1Pitch: 6,
      lkJitter: 0.1,
      echoFrames: 30, echoFb: 8, echoMix: 0.22, echoPing: 1,
      rvMix: 0.65, rvSize: 1, rvDecay: 10, rvTone: 0.7, volume: 0.39,
    },
  },
  {
    name: 'String Machine', tag: 'pad',
    values: {
      // the brighter drawn saw between two free-width pulses, the duty rotating like an ensemble
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4,
      p1Duty: 4, p1Width: 0.35, p1Level: 0.28, p1Fine: -9, p1Pan: -0.7, p1Atk: 0.5, p1Dec: 1, p1Sus: 0.95, p1Rel: 1.5,
      p2Duty: 4, p2Width: 0.65, p2Level: 0.28, p2Oct: 1, p2Fine: 9, p2Pan: 0.7, p2Atk: 0.5, p2Dec: 1, p2Sus: 0.95, p2Rel: 1.5,
      wvLevel: 0.55, wvAtk: 0.45, wvDec: 1, wvSus: 0.95, wvRel: 1.5, ...tab('wv', STRING32),
      frameHz: 50, r1Op: 0, r1Step: 10, r1Div: 1, r1Pitch: 7, r2Op: 0, r2Step: 5, r2Div: 1, r2Duty: 0.4,
      fMode: 1, cutoff: 4200, res: 0.08,
      echoFrames: 12, echoFb: 5, echoMix: 0.15, echoPing: 1,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.6, volume: 0.48,
    },
  },
  {
    name: 'Dawn Array', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Level: 0,
      pdLevel: 0.45, pdShape: 0, pdAmt: 0.25, pdEnvAmt: 0.5, pdFine: -6, pdPan: -0.6, pdAtk: 2, pdDec: 4, pdSus: 0.7, pdRel: 4,
      fmLevel: 0.35, fmRatio: 2, fmIndex: 0.12, fmEnvAmt: 0.3, fmFine: 6, fmPan: 0.6, fmAtk: 2.5, fmDec: 4, fmSus: 0.8, fmRel: 4,
      wvLevel: 0.5, wvOct: -1, wvAtk: 1.5, wvSus: 1, wvRel: 4, ...tab('wv', WARM32),
      frameHz: 24, r1Op: 0, r1Step: 3, r1Div: 1, r1Pitch: 5, caRule: 90, caDiv: 8, caCut: 0.15,
      fMode: 1, cutoff: 3200, res: 0.12,
      lkDrift: 0.2,
      echoFrames: 24, echoFb: 7, echoMix: 0.2, echoPing: 1,
      rvMix: 0.6, rvSize: 1, rvDecay: 8, rvTone: 0.6, volume: 0.45,
    },
  },
  {
    name: 'Vapor Halo', tag: 'pad',
    values: {
      // a light touch of the codec makes the top shimmer like a stream
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Duty: 4, p1Width: 0.3, p1Level: 0.25, p1Fine: -10, p1Pan: -0.8, p1Atk: 1.8, p1Sus: 0.9, p1Rel: 4,
      p2Duty: 4, p2Width: 0.7, p2Level: 0.25, p2Fine: 10, p2Pan: 0.8, p2Atk: 1.8, p2Sus: 0.9, p2Rel: 4,
      wvLevel: 0.55, wvAtk: 1.5, wvSus: 1, wvRel: 4, ...tab('wv', ORGAN32),
      fmLevel: 0.2, fmOct: 1, fmRatio: 1, fmIndex: 0.08, fmEnvAmt: 0, fmAtk: 3, fmSus: 1, fmRel: 4,
      frameHz: 30, r1Op: 0, r1Step: 4, r1Div: 1, r1Pitch: 7, r2Op: 0, r2Step: 2, r2Div: 1, r2Duty: 0.35,
      fMode: 1, cutoff: 5000, res: 0.1,
      lkCodec: 0.3, lkKbps: 64,
      echoFrames: 30, echoFb: 7, echoMix: 0.2, echoPing: 1,
      rvMix: 0.6, rvSize: 1, rvDecay: 9, rvTone: 0.65, volume: 0.45,
    },
  },
  {
    name: 'Deep Field', tag: 'pad',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.2,
      p1Duty: 2, p1Level: 0.25, p1Oct: -1, p1Fine: -6, p1Pan: -0.7, p1Atk: 3, p1Sus: 1, p1Rel: 6,
      p2Duty: 2, p2Level: 0.25, p2Oct: -1, p2Semi: 7, p2Fine: 6, p2Pan: 0.7, p2Atk: 3, p2Sus: 1, p2Rel: 6,
      wvLevel: 0.6, wvOct: -2, wvAtk: 2.5, wvSus: 1, wvRel: 6, ...tab('wv', WARM32),
      fmLevel: 0.15, fmOct: 1, fmRatio: 1, fmIndex: 0.1, fmEnvAmt: 0, fmAtk: 5, fmSus: 1, fmRel: 6,
      frameHz: 12, r1Op: 0, r1Step: 2, r1Div: 1, r1Pitch: 5, r2Op: 0, r2Step: 2, r2Div: 1, r2Cut: 0.3,
      fMode: 1, cutoff: 1200, res: 0.25,
      lkDrift: 0.35,
      echoFrames: 32, echoFb: 8, echoMix: 0.2, echoPing: 1,
      rvMix: 0.65, rvSize: 1, rvDecay: 10, rvTone: 0.35, volume: 0.42,
    },
  },
  // ----------------------------------------------------------- glass keys & bells
  {
    name: 'Glass Rhodes', tag: 'glass',
    values: {
      // an FM tine, a sine body under it, and a stepped tremolo from register 1
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.8,
      p1Level: 0,
      fmLevel: 0.75, fmRatio: 1, fmIndex: 0.4, fmEnvAmt: 0.9, fmPan: -0.25, fmAtk: 0.001, fmDec: 2, fmSus: 0.2, fmRel: 0.8,
      wvLevel: 0.45, wvFine: -5, wvPan: 0.25, wvAtk: 0.003, wvDec: 2.5, wvSus: 0.3, wvRel: 0.8, ...tab('wv', SINE32),
      pdLevel: 0.2, pdShape: 4, pdAmt: 0.3, pdEnvAmt: 1, pdOct: 2, pdAtk: 0.001, pdDec: 0.2, pdSus: 0, pdRel: 0.2,
      frameHz: 60, r1Op: 0, r1Step: 24, r1Div: 1, r1Level: 0.18,
      lkDrift: 0.1,
      echoFrames: 15, echoFb: 5, echoMix: 0.15, echoPing: 1,
      rvMix: 0.3, rvSize: 0.75, rvDecay: 2.5, rvTone: 0.6, volume: 0.54,
    },
  },
  {
    name: 'Celesta Array', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.7,
      p1Level: 0,
      fmLevel: 0.6, fmRatio: 4, fmIndex: 0.25, fmEnvAmt: 1, fmOct: 1, fmPan: 0.3, fmAtk: 0.001, fmDec: 0.8, fmSus: 0, fmRel: 0.8,
      wvLevel: 0.55, wvOct: 1, wvFine: 4, wvPan: -0.3, wvAtk: 0.001, wvDec: 1.5, wvSus: 0, wvRel: 1.2, ...tab('wv', BELL32),
      echoFrames: 18, echoFb: 7, echoMix: 0.28, echoPing: 1,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.8, volume: 0.64,
    },
  },
  {
    name: 'Crystal Harp', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.7,
      p1Level: 0,
      pdLevel: 0.6, pdShape: 4, pdAmt: 0.3, pdEnvAmt: 1, pdPan: -0.3, pdAtk: 0.001, pdDec: 1.6, pdSus: 0, pdRel: 1.5,
      fmLevel: 0.4, fmRatio: 2, fmIndex: 0.2, fmEnvAmt: 1, fmFine: 6, fmPan: 0.35, fmAtk: 0.001, fmDec: 1.2, fmSus: 0, fmRel: 1.2,
      wvLevel: 0.35, wvOct: -1, wvAtk: 0.002, wvDec: 2, wvSus: 0, wvRel: 1.5, ...tab('wv', SINE32),
      echoFrames: 24, echoFb: 7, echoMix: 0.25, echoPing: 1,
      rvMix: 0.5, rvSize: 1, rvDecay: 5, rvTone: 0.7, volume: 0.65,
    },
  },
  {
    name: 'Bell Garden', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Level: 0,
      fmLevel: 0.6, fmRatio: 3.5, fmIndex: 0.35, fmFb: 0.05, fmEnvAmt: 0.8, fmPan: -0.4, fmAtk: 0.001, fmDec: 3, fmSus: 0, fmRel: 3,
      pdLevel: 0.3, pdShape: 3, pdAmt: 0.4, pdEnvAmt: 0.8, pdOct: 2, pdFine: 7, pdPan: 0.45, pdAtk: 0.001, pdDec: 1.5, pdSus: 0, pdRel: 2,
      wvLevel: 0.35, wvAtk: 0.002, wvDec: 3, wvSus: 0, wvRel: 3, ...tab('wv', BELL32),
      frameHz: 30, r1Op: 0, r1Step: 3, r1Div: 1, r1Pitch: 4,
      echoFrames: 30, echoFb: 8, echoMix: 0.25, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 6, rvTone: 0.8, volume: 0.48,
    },
  },
  {
    name: 'Velvet EP', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.8,
      p1Level: 0,
      wvLevel: 0.6, wvAtk: 0.003, wvDec: 3, wvSus: 0.2, wvRel: 0.6, ...tab('wv', WARM32),
      fmLevel: 0.45, fmRatio: 1, fmIndex: 0.25, fmEnvAmt: 0.8, fmFine: 5, fmPan: 0.3, fmAtk: 0.001, fmDec: 1.4, fmSus: 0.15, fmRel: 0.6,
      pdLevel: 0.2, pdShape: 0, pdAmt: 0.2, pdEnvAmt: 1, pdFine: -5, pdPan: -0.3, pdAtk: 0.001, pdDec: 0.8, pdSus: 0, pdRel: 0.5,
      frameHz: 50, r1Op: 0, r1Step: 18, r1Div: 1, r1Level: 0.15,
      fMode: 1, cutoff: 3600, res: 0.08,
      lkDrift: 0.12,
      echoFrames: 18, echoFb: 5, echoMix: 0.15, echoPing: 1,
      rvMix: 0.3, rvSize: 0.7, rvDecay: 2.2, rvTone: 0.55, volume: 0.84,
    },
  },
  {
    name: 'Music Box Grid', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      fmLevel: 0.55, fmRatio: 5, fmIndex: 0.2, fmEnvAmt: 1, fmOct: 1, fmAtk: 0.001, fmDec: 1.2, fmSus: 0, fmRel: 1.2,
      wvLevel: 0.4, wvOct: 2, wvFine: 6, wvPan: 0.4, wvAtk: 0.001, wvDec: 0.9, wvSus: 0, wvRel: 0.9, ...tab('wv', SINE32),
      frameHz: 40, r1Op: 0, r1Step: 4, r1Div: 1, r1Pitch: 5,
      echoFrames: 12, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.45, rvSize: 0.85, rvDecay: 3.5, rvTone: 0.8, volume: 0.66,
    },
  },
  {
    name: 'Tine Kalimba', tag: 'glass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.8,
      p1Level: 0,
      fmLevel: 0.65, fmRatio: 3, fmIndex: 0.3, fmEnvAmt: 1, fmAtk: 0.001, fmDec: 0.5, fmSus: 0, fmRel: 0.5,
      pdLevel: 0.35, pdShape: 5, pdAmt: 0.35, pdEnvAmt: 1, pdOct: 1, pdPan: 0.35, pdAtk: 0.001, pdDec: 0.25, pdSus: 0, pdRel: 0.3,
      wvLevel: 0.3, wvAtk: 0.001, wvDec: 0.7, wvSus: 0, wvRel: 0.5, wvPan: -0.3, ...tab('wv', SINE32),
      echoFrames: 18, echoFb: 6, echoMix: 0.25, echoPing: 1,
      rvMix: 0.35, rvSize: 0.75, rvDecay: 2.5, rvTone: 0.7, volume: 0.86,
    },
  },
  // -------------------------------------------------------------------- plucks
  {
    name: 'Neon Pluck', tag: 'pluck',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Duty: 4, p1Width: 0.35, p1Level: 0.3, p1Fine: -9, p1Pan: -0.7, p1Atk: 0.001, p1Dec: 0.45, p1Sus: 0, p1Rel: 0.4,
      p2Duty: 4, p2Width: 0.65, p2Level: 0.3, p2Fine: 9, p2Pan: 0.7, p2Atk: 0.001, p2Dec: 0.45, p2Sus: 0, p2Rel: 0.4,
      pdLevel: 0.5, pdShape: 0, pdAmt: 0.2, pdEnvAmt: 1, pdAtk: 0.001, pdDec: 0.3, pdSus: 0, pdRel: 0.3,
      fMode: 1, cutoff: 3200, res: 0.2,
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.4, rvSize: 0.85, rvDecay: 3, rvTone: 0.65, volume: 1,
    },
  },
  {
    name: 'Glass Pluck', tag: 'pluck',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.7,
      p1Level: 0,
      fmLevel: 0.65, fmRatio: 2, fmIndex: 0.5, fmEnvAmt: 1, fmPan: -0.25, fmAtk: 0.001, fmDec: 0.4, fmSus: 0, fmRel: 0.4,
      wvLevel: 0.45, wvFine: 5, wvPan: 0.3, wvAtk: 0.001, wvDec: 0.8, wvSus: 0, wvRel: 0.6, ...tab('wv', SINE32),
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.4, rvSize: 0.85, rvDecay: 3, rvTone: 0.75, volume: 0.79,
    },
  },
  {
    name: 'Harp Stack', tag: 'pluck',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Duty: 0, p1Level: 0.15, p1Oct: 1, p1Fine: 6, p1Pan: 0.5, p1Atk: 0.001, p1Dec: 0.6, p1Sus: 0, p1Rel: 0.6,
      pdLevel: 0.6, pdShape: 5, pdAmt: 0.3, pdEnvAmt: 1, pdPan: -0.3, pdAtk: 0.001, pdDec: 1.4, pdSus: 0, pdRel: 1.2,
      wvLevel: 0.4, wvOct: -1, wvAtk: 0.002, wvDec: 1.6, wvSus: 0, wvRel: 1.2, ...tab('wv', WARM32),
      echoFrames: 24, echoFb: 6, echoMix: 0.22, echoPing: 1,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.65, volume: 0.76,
    },
  },
  {
    name: 'Data Koto', tag: 'pluck',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.7,
      p1Level: 0,
      pdLevel: 0.65, pdShape: 4, pdAmt: 0.45, pdEnvAmt: 1, pdAtk: 0.001, pdDec: 0.9, pdSus: 0, pdRel: 0.7,
      fmLevel: 0.3, fmRatio: 3, fmIndex: 0.2, fmEnvAmt: 1, fmFine: 5, fmPan: 0.4, fmAtk: 0.001, fmDec: 0.4, fmSus: 0, fmRel: 0.4,
      frameHz: 60, r1Op: 0, r1Step: 32, r1Div: 1, r1Pitch: 10,
      echoFrames: 24, echoFb: 6, echoMix: 0.22, echoPing: 1,
      rvMix: 0.4, rvSize: 0.8, rvDecay: 3, rvTone: 0.6, volume: 0.9,
    },
  },
  {
    name: 'Pizz Array', tag: 'pluck',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Duty: 2, p1Level: 0.3, p1Fine: -8, p1Pan: -0.6, p1Atk: 0.002, p1Dec: 0.22, p1Sus: 0, p1Rel: 0.25,
      p2Duty: 1, p2Level: 0.3, p2Fine: 8, p2Pan: 0.6, p2Atk: 0.002, p2Dec: 0.22, p2Sus: 0, p2Rel: 0.25,
      wvLevel: 0.4, wvAtk: 0.002, wvDec: 0.3, wvSus: 0, wvRel: 0.3, ...tab('wv', STRING32),
      fMode: 1, cutoff: 2200, res: 0.1,
      echoFrames: 12, echoFb: 5, echoMix: 0.2, echoPing: 1,
      rvMix: 0.45, rvSize: 0.85, rvDecay: 2.8, rvTone: 0.55, volume: 1,
    },
  },
  {
    name: 'Supersquare Pluck', tag: 'pluck',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 4, p1Width: 0.5, p1Level: 0.28, p1Fine: -14, p1Pan: -0.8, p1Atk: 0.001, p1Dec: 0.5, p1Sus: 0, p1Rel: 0.4,
      p2Duty: 4, p2Width: 0.5, p2Level: 0.28, p2Fine: 14, p2Pan: 0.8, p2Atk: 0.001, p2Dec: 0.5, p2Sus: 0, p2Rel: 0.4,
      wvLevel: 0.35, wvFine: 5, wvAtk: 0.001, wvDec: 0.5, wvSus: 0, wvRel: 0.4, ...tab('wv', SAW32),
      pdLevel: 0.35, pdShape: 0, pdAmt: 0.7, pdEnvAmt: 1, pdOct: -1, pdAtk: 0.001, pdDec: 0.4, pdSus: 0, pdRel: 0.35,
      fMode: 1, cutoff: 4500, res: 0.15,
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.4, rvSize: 0.85, rvDecay: 3, rvTone: 0.6, volume: 0.81,
    },
  },
  // --------------------------------------------------------------------- leads
  {
    name: 'Laser Violin', tag: 'lead',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5, glide: 0.4,
      p1Duty: 4, p1Width: 0.4, p1Level: 0.3, p1Fine: -6, p1Pan: -0.4, p1Atk: 0.08, p1Sus: 0.9, p1Rel: 0.4,
      wvLevel: 0.65, wvFine: 6, wvPan: 0.3, wvAtk: 0.06, wvSus: 0.9, wvRel: 0.4, ...tab('wv', STRING32),
      frameHz: 60, r1Op: 0, r1Step: 30, r1Div: 1, r1Pitch: 18, r2Op: 0, r2Step: 6, r2Div: 1, r2Duty: 0.25,
      fMode: 1, cutoff: 4200, res: 0.15,
      echoFrames: 18, echoFb: 7, echoMix: 0.28, echoPing: 1,
      rvMix: 0.4, rvSize: 0.85, rvDecay: 3, rvTone: 0.6, volume: 0.52,
    },
  },
  {
    name: 'Vector Saw', tag: 'lead',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4, glide: 0.3,
      p1Duty: 4, p1Width: 0.5, p1Level: 0.28, p1Fine: -10, p1Pan: -0.6, p1Sus: 0.9, p1Rel: 0.3,
      p2Duty: 4, p2Width: 0.5, p2Level: 0.28, p2Fine: 10, p2Pan: 0.6, p2Sus: 0.9, p2Rel: 0.3,
      pdLevel: 0.6, pdShape: 0, pdAmt: 0.9, pdEnvAmt: 0.2, pdSus: 0.9, pdRel: 0.3,
      frameHz: 60, r1Op: 0, r1Step: 34, r1Div: 1, r1Pitch: 14,
      fMode: 1, cutoff: 5000, res: 0.2,
      echoFrames: 18, echoFb: 7, echoMix: 0.28, echoPing: 1,
      rvMix: 0.3, rvSize: 0.75, rvDecay: 2.5, volume: 0.47,
    },
  },
  {
    name: 'Glass Flute', tag: 'lead',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5, glide: 0.25,
      p1Level: 0,
      wvLevel: 0.7, wvAtk: 0.06, wvSus: 0.9, wvRel: 0.35, ...tab('wv', WARM32),
      fmLevel: 0.2, fmOct: 1, fmRatio: 1, fmIndex: 0.1, fmEnvAmt: 0.3, fmAtk: 0.08, fmSus: 0.8, fmRel: 0.35, fmPan: 0.3,
      nzLevel: 0.05, nzOct: 4, nzMode: 1, nzAtk: 0.05, nzDec: 0.3, nzSus: 0.4, nzRel: 0.3,
      frameHz: 60, r1Op: 0, r1Step: 28, r1Div: 1, r1Pitch: 12,
      fMode: 1, cutoff: 3800, res: 0.1,
      echoFrames: 24, echoFb: 6, echoMix: 0.22, echoPing: 1,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 3.5, rvTone: 0.6, volume: 0.51,
    },
  },
  {
    name: 'Resonant Laser', tag: 'lead',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5, glide: 0.2,
      p1Level: 0,
      pdLevel: 0.7, pdShape: 4, pdAmt: 0.7, pdEnvAmt: 0.6, pdAtk: 0.003, pdDec: 0.6, pdSus: 0.6, pdRel: 0.3,
      fmLevel: 0.35, fmRatio: 2, fmIndex: 0.3, fmFb: 0.3, fmEnvAmt: 0.5, fmFine: 6, fmPan: 0.4, fmAtk: 0.003, fmSus: 0.8, fmRel: 0.3,
      frameHz: 60, r1Op: 0, r1Step: 32, r1Div: 1, r1Pitch: 14,
      echoFrames: 18, echoFb: 7, echoMix: 0.28, echoPing: 1,
      rvMix: 0.3, rvSize: 0.75, rvDecay: 2.5, rvTone: 0.65, volume: 0.65,
    },
  },
  {
    name: 'Portamento Square', tag: 'lead',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4, glide: 0.8,
      p1Duty: 2, p1Level: 0.45, p1Fine: -5, p1Pan: -0.3, p1Sus: 0.9, p1Rel: 0.3,
      p2Duty: 1, p2Level: 0.3, p2Oct: -1, p2Fine: 5, p2Pan: 0.3, p2Sus: 0.9, p2Rel: 0.3,
      wvLevel: 0.4, wvOct: -1, wvSus: 1, wvRel: 0.3, ...tab('wv', SINE32),
      frameHz: 60, r1Op: 0, r1Step: 26, r1Div: 1, r1Pitch: 12,
      fMode: 1, cutoff: 3500, res: 0.15,
      echoFrames: 18, echoFb: 7, echoMix: 0.28, echoPing: 1,
      rvMix: 0.3, rvSize: 0.8, rvDecay: 2.5, volume: 0.5,
    },
  },
  {
    name: 'Choir Lead', tag: 'lead',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4, glide: 0.3,
      p1Level: 0,
      wvLevel: 0.7, wvAtk: 0.05, wvSus: 0.9, wvRel: 0.4, ...tab('wv', VOX32),
      fmLevel: 0.3, fmRatio: 2, fmIndex: 0.15, fmFb: 0.2, fmEnvAmt: 0.3, fmFine: 7, fmPan: 0.4, fmAtk: 0.08, fmSus: 0.8, fmRel: 0.4,
      pdLevel: 0.25, pdShape: 3, pdAmt: 0.3, pdEnvAmt: 0.3, pdFine: -7, pdPan: -0.4, pdAtk: 0.08, pdSus: 0.8, pdRel: 0.4,
      frameHz: 60, r1Op: 0, r1Step: 30, r1Div: 1, r1Pitch: 14,
      fMode: 1, cutoff: 4000, res: 0.2,
      echoFrames: 24, echoFb: 7, echoMix: 0.28, echoPing: 1,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.6, volume: 0.44,
    },
  },
  // ---------------------------------------------------------------------- bass
  {
    name: 'Velvet Sub', tag: 'bass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 1, p1Level: 0.3, p1Oct: -1, p1Fine: -4, p1Pan: -0.2, p1Atk: 0.002, p1Dec: 0.3, p1Sus: 0.3, p1Rel: 0.1,
      p2Duty: 1, p2Level: 0.3, p2Oct: -1, p2Fine: 4, p2Pan: 0.2, p2Atk: 0.002, p2Dec: 0.3, p2Sus: 0.3, p2Rel: 0.1,
      wvLevel: 0.9, wvOct: -2, wvAtk: 0.002, wvSus: 1, wvRel: 0.12, ...tab('wv', SINE32),
      fMode: 1, cutoff: 900, res: 0.2,
      rvMix: 0.05, rvDecay: 0.8, volume: 0.52,
    },
  },
  {
    name: 'PD Growl', tag: 'bass',
    values: {
      // a resonant phase-distortion saw that the frame clock chews on the beat
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      pdLevel: 0.7, pdShape: 4, pdAmt: 0.6, pdEnvAmt: 0.6, pdOct: -1, pdAtk: 0.002, pdDec: 0.3, pdSus: 0.8, pdRel: 0.12,
      wvLevel: 0.7, wvOct: -2, wvAtk: 0.002, wvSus: 1, wvRel: 0.12, ...tab('wv', SINE32),
      frameHz: 120, frameSync: 1, tempo: 140, r1Op: 0, r1Step: 32, r1Div: 1, r1Cut: 0.5,
      fMode: 1, cutoff: 900, res: 0.45,
      rvMix: 0.06, rvDecay: 0.8, volume: 0.56,
    },
  },
  {
    name: 'Pluck Bass Array', tag: 'bass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.7,
      p1Duty: 2, p1Level: 0.35, p1Oct: -1, p1Fine: -7, p1Pan: -0.3, p1Atk: 0.001, p1Dec: 0.3, p1Sus: 0.2, p1Rel: 0.1,
      p2Duty: 2, p2Level: 0.35, p2Oct: -1, p2Fine: 7, p2Pan: 0.3, p2Atk: 0.001, p2Dec: 0.3, p2Sus: 0.2, p2Rel: 0.1,
      pdLevel: 0.45, pdShape: 0, pdAmt: 0.4, pdEnvAmt: 1, pdOct: -1, pdAtk: 0.001, pdDec: 0.2, pdSus: 0, pdRel: 0.1,
      wvLevel: 0.6, wvOct: -2, wvAtk: 0.001, wvSus: 1, wvRel: 0.1, ...tab('wv', SINE32),
      fMode: 1, cutoff: 1500, res: 0.25,
      echoFrames: 12, echoFb: 3, echoMix: 0.12, echoPing: 1,
      rvMix: 0.06, rvDecay: 0.8, volume: 0.64,
    },
  },
  {
    name: 'Octave Runner', tag: 'bass',
    values: {
      // hold one note: the pitch table bounces it note / octave on the sixteenths
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 4, p1Width: 0.4, p1Level: 0.32, p1Oct: -1, p1Fine: -6, p1Pan: -0.3, p1Env: 2, p1Rel: 0.08, p1PTab: 1,
      p2Duty: 4, p2Width: 0.6, p2Level: 0.32, p2Oct: -1, p2Fine: 6, p2Pan: 0.3, p2Env: 2, p2Rel: 0.08, p2PTab: 1,
      wvLevel: 0.7, wvOct: -2, wvSus: 1, wvRel: 0.08, ...tab('wv', SINE32),
      ...tab('tvB', [15, 12, 9, 7, 15, 12, 9, 7, 15, 12, 9, 7, 15, 12, 9, 7]), tvBLoop: 0,
      ...tab('tp', [0, 0, 0, 0, 12, 12, 12, 12, 0, 0, 0, 0, 12, 12, 12, 12]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 124, tabDiv: 3,
      fMode: 1, cutoff: 1400, res: 0.3,
      echoFrames: 18, echoFb: 4, echoMix: 0.12, echoPing: 1,
      rvMix: 0.06, rvDecay: 0.8, volume: 0.53,
    },
  },
  {
    name: 'FM Rubber', tag: 'bass',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.7,
      p1Level: 0,
      fmLevel: 0.75, fmOct: -1, fmRatio: 1, fmIndex: 0.6, fmFb: 0.15, fmEnvAmt: 0.9, fmAtk: 0.001, fmDec: 0.2, fmSus: 0.3, fmRel: 0.1,
      wvLevel: 0.6, wvOct: -2, wvAtk: 0.001, wvSus: 1, wvRel: 0.1, ...tab('wv', HOLLOW32),
      fMode: 1, cutoff: 1800, res: 0.25,
      rvMix: 0.05, rvDecay: 0.6, volume: 0.61,
    },
  },
  // ---------------------------------------------------------------------- arps
  {
    name: 'Glass Cascade', tag: 'arp',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      fmLevel: 0.6, fmRatio: 3, fmIndex: 0.35, fmEnvAmt: 1, fmPan: -0.3, fmAtk: 0.001, fmDec: 0.35, fmSus: 0, fmRel: 0.4,
      wvLevel: 0.4, wvOct: 1, wvFine: 5, wvPan: 0.35, wvAtk: 0.001, wvDec: 0.5, wvSus: 0, wvRel: 0.5, ...tab('wv', BELL32),
      frameHz: 120, frameSync: 1, tempo: 112, arpMode: 2, arpDiv: 3, arpOct: 3, arpGate: 0.6,
      echoFrames: 18, echoFb: 8, echoMix: 0.3, echoPing: 1,
      rvMix: 0.5, rvSize: 1, rvDecay: 5, rvTone: 0.8, volume: 0.62,
    },
  },
  {
    name: 'Starlight Arp', tag: 'arp',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      pdLevel: 0.55, pdShape: 3, pdAmt: 0.4, pdEnvAmt: 1, pdPan: -0.35, pdAtk: 0.001, pdDec: 0.4, pdSus: 0, pdRel: 0.45,
      fmLevel: 0.4, fmRatio: 2, fmIndex: 0.25, fmEnvAmt: 1, fmOct: 1, fmFine: 6, fmPan: 0.4, fmAtk: 0.001, fmDec: 0.5, fmSus: 0, fmRel: 0.5,
      wvLevel: 0.35, wvOct: -1, wvAtk: 0.001, wvDec: 0.6, wvSus: 0.1, wvRel: 0.5, ...tab('wv', WARM32),
      frameHz: 120, frameSync: 1, tempo: 116, arpMode: 3, arpDiv: 6, arpOct: 2, arpGate: 0.7,
      echoFrames: 18, echoFb: 8, echoMix: 0.32, echoPing: 1,
      rvMix: 0.5, rvSize: 1, rvDecay: 5, rvTone: 0.7, volume: 0.51,
    },
  },
  {
    name: 'Triplet Prism', tag: 'arp',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 4, p1Width: 0.3, p1Level: 0.25, p1Fine: -7, p1Pan: -0.6, p1Atk: 0.001, p1Dec: 0.3, p1Sus: 0, p1Rel: 0.3,
      p2Duty: 4, p2Width: 0.7, p2Level: 0.25, p2Fine: 7, p2Pan: 0.6, p2Atk: 0.001, p2Dec: 0.3, p2Sus: 0, p2Rel: 0.3,
      fmLevel: 0.4, fmRatio: 4, fmIndex: 0.2, fmEnvAmt: 1, fmAtk: 0.001, fmDec: 0.3, fmSus: 0, fmRel: 0.3,
      frameHz: 120, frameSync: 1, tempo: 100, arpMode: 1, arpDiv: 4, arpOct: 3, arpGate: 0.6,
      fMode: 1, cutoff: 4000, res: 0.15,
      echoFrames: 16, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.7, volume: 0.84,
    },
  },
  {
    name: 'Random Rain', tag: 'arp',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      wvLevel: 0.5, wvAtk: 0.001, wvDec: 0.5, wvSus: 0, wvRel: 0.6, ...tab('wv', SINE32),
      pdLevel: 0.4, pdShape: 5, pdAmt: 0.35, pdEnvAmt: 1, pdOct: 1, pdFine: 6, pdPan: 0.4, pdAtk: 0.001, pdDec: 0.3, pdSus: 0, pdRel: 0.4,
      frameHz: 120, frameSync: 1, tempo: 96, arpMode: 4, arpDiv: 6, arpOct: 2, arpGate: 0.5,
      lkJitter: 0.1,
      echoFrames: 24, echoFb: 8, echoMix: 0.32, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 6, rvTone: 0.65, volume: 0.71,
    },
  },
  {
    name: 'Played Pulse', tag: 'arp',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Duty: 1, p1Level: 0.3, p1Fine: -8, p1Pan: -0.6, p1Atk: 0.002, p1Dec: 0.5, p1Sus: 0.3, p1Rel: 0.4,
      p2Duty: 1, p2Level: 0.3, p2Fine: 8, p2Pan: 0.6, p2Atk: 0.002, p2Dec: 0.5, p2Sus: 0.3, p2Rel: 0.4,
      wvLevel: 0.45, wvOct: -1, wvAtk: 0.002, wvDec: 0.6, wvSus: 0.3, wvRel: 0.4, ...tab('wv', HOLLOW32),
      frameHz: 120, frameSync: 1, tempo: 108, arpMode: 5, arpDiv: 12, arpOct: 1, arpGate: 0.8,
      r2Op: 0, r2Step: 4, r2Div: 1, r2Duty: 0.3,
      fMode: 1, cutoff: 2800, res: 0.2,
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 4, volume: 0.77,
    },
  },
  {
    name: 'Chord Shimmer', tag: 'arp',
    values: {
      // one key plays a major-seventh arpeggio on the sixteenths: the chord arp, frame-synced
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      fmLevel: 0.5, fmRatio: 2, fmIndex: 0.2, fmEnvAmt: 0.6, fmPan: -0.35, fmAtk: 0.002, fmDec: 0.8, fmSus: 0.4, fmRel: 1,
      wvLevel: 0.45, wvFine: 5, wvPan: 0.35, wvAtk: 0.002, wvDec: 0.8, wvSus: 0.4, wvRel: 1, ...tab('wv', WARM32),
      pdLevel: 0.25, pdShape: 3, pdAmt: 0.3, pdEnvAmt: 0.5, pdOct: 1, pdAtk: 0.002, pdDec: 0.5, pdSus: 0.2, pdRel: 0.8,
      chord: 6, chordSpeed: 6, chordDir: 2, chordOct: 1,
      frameHz: 120, frameSync: 1, tempo: 112,
      echoFrames: 18, echoFb: 8, echoMix: 0.32, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 6, rvTone: 0.7, volume: 0.54,
    },
  },
  // ----------------------------------------------------------------- sequences
  {
    name: 'Table Melody', tag: 'seq',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      wvLevel: 0.6, wvEnv: 2, wvRel: 0.3, wvPTab: 1, ...tab('wv', WARM32),
      fmLevel: 0.4, fmRatio: 2, fmIndex: 0.2, fmEnvAmt: 0, fmEnv: 2, fmFine: 6, fmPan: 0.4, fmRel: 0.3, fmPTab: 1,
      pdLevel: 0.3, pdShape: 3, pdAmt: 0.3, pdEnvAmt: 0, pdEnv: 2, pdFine: -6, pdPan: -0.4, pdRel: 0.3, pdPTab: 1,
      ...tab('tvB', [15, 7, 15, 7, 15, 7, 15, 7, 15, 7, 15, 7, 15, 7, 15, 7]), tvBLoop: 0,
      ...tab('tp', [0, 0, 7, 7, 3, 3, 10, 10, 12, 12, 10, 10, 7, 7, 3, 3]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 112, tabDiv: 3,
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.5, rvSize: 1, rvDecay: 5, rvTone: 0.65, volume: 0.45,
    },
  },
  {
    name: 'Berlin Table', tag: 'seq',
    values: {
      // the sequence from the pitch table, register 1 sweeping the filter slowly over it
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 4, p1Width: 0.45, p1Level: 0.3, p1Fine: -7, p1Pan: -0.5, p1Env: 2, p1Rel: 0.1, p1PTab: 1,
      p2Duty: 4, p2Width: 0.55, p2Level: 0.3, p2Fine: 7, p2Pan: 0.5, p2Env: 2, p2Rel: 0.1, p2PTab: 1,
      wvLevel: 0.5, wvOct: -1, wvEnv: 2, wvRel: 0.1, wvPTab: 1, ...tab('wv', SOFTSAW32),
      ...tab('tvB', [15, 6, 13, 5, 15, 6, 13, 5, 15, 6, 13, 5, 15, 6, 14, 8]), tvBLoop: 0,
      ...tab('tp', [0, 0, 12, 12, 0, 0, 7, 7, 0, 0, 12, 12, 3, 3, 5, 5]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 120, tabDiv: 3,
      r1Op: 0, r1Step: 2, r1Div: 4, r1Cut: 0.55,
      fMode: 1, cutoff: 1400, res: 0.45,
      echoFrames: 18, echoFb: 8, echoMix: 0.32, echoPing: 1,
      rvMix: 0.3, rvSize: 0.8, rvDecay: 3, volume: 0.51,
    },
  },
  {
    name: 'Gate Choir', tag: 'seq',
    values: {
      // a choir pad chopped into a rhythm by volume table B on the sixteenths
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4,
      p1Duty: 1, p1Level: 0.25, p1Fine: -9, p1Pan: -0.7, p1Env: 2, p1Rel: 0.06,
      p2Duty: 1, p2Level: 0.25, p2Fine: 9, p2Pan: 0.7, p2Env: 2, p2Rel: 0.06,
      wvLevel: 0.55, wvEnv: 2, wvRel: 0.06, ...tab('wv', CHOIR32),
      fmLevel: 0.2, fmOct: -1, fmRatio: 1, fmIndex: 0.1, fmEnvAmt: 0, fmEnv: 2, fmRel: 0.06,
      ...tab('tvB', [15, 15, 0, 15, 0, 15, 15, 0, 15, 0, 15, 15, 0, 15, 0, 9]), tvBLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 128, tabDiv: 6,
      r1Op: 0, r1Step: 3, r1Div: 2, r1Cut: 0.35,
      fMode: 1, cutoff: 3000, res: 0.2,
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 4, rvTone: 0.6, volume: 0.5,
    },
  },
  {
    name: 'Euclid Glass', tag: 'seq',
    values: {
      // five bell strikes spread over sixteen steps, each on a different note
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      fmLevel: 0.6, fmRatio: 3.5, fmIndex: 0.3, fmEnvAmt: 0, fmEnv: 2, fmPan: -0.3, fmRel: 0.6, fmPTab: 1,
      wvLevel: 0.45, wvOct: 1, wvFine: 5, wvPan: 0.35, wvEnv: 2, wvRel: 0.6, wvPTab: 1, ...tab('wv', BELL32),
      ...tab('tvB', [15, 6, 2, 15, 6, 2, 15, 6, 2, 0, 15, 6, 2, 15, 6, 2]), tvBLoop: 0,
      ...tab('tp', [0, 0, 0, 7, 7, 7, 3, 3, 3, 3, 10, 10, 10, 5, 5, 5]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 108, tabDiv: 6,
      echoFrames: 18, echoFb: 8, echoMix: 0.35, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 6, rvTone: 0.8, volume: 0.42,
    },
  },
  {
    name: 'Rule 90 Garden', tag: 'seq',
    values: {
      // the automaton picks the interval of every note the arp plays
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      fmLevel: 0.55, fmRatio: 2, fmIndex: 0.3, fmEnvAmt: 1, fmPan: -0.3, fmAtk: 0.001, fmDec: 0.5, fmSus: 0, fmRel: 0.6,
      wvLevel: 0.4, wvFine: 5, wvPan: 0.35, wvAtk: 0.001, wvDec: 0.7, wvSus: 0, wvRel: 0.6, ...tab('wv', WARM32),
      frameHz: 120, frameSync: 1, tempo: 104, arpMode: 5, arpDiv: 12, arpOct: 1, arpGate: 0.6,
      caRule: 90, caDiv: 12, caPitch: 12,
      echoFrames: 18, echoFb: 8, echoMix: 0.35, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 5.5, rvTone: 0.7, volume: 0.81,
    },
  },
  {
    name: 'Phaser Sequence', tag: 'seq',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 4, p1Width: 0.5, p1Level: 0.35, p1Fine: -6, p1Pan: -0.5, p1Env: 2, p1Rel: 0.08, p1PTab: 1,
      p2Duty: 4, p2Width: 0.5, p2Level: 0.35, p2Fine: 6, p2Pan: 0.5, p2Env: 2, p2Rel: 0.08, p2PTab: 1,
      wvLevel: 0.4, wvOct: -1, wvEnv: 2, wvRel: 0.08, wvPTab: 1, ...tab('wv', HOLLOW32),
      ...tab('tvB', [15, 8, 15, 8, 15, 8, 15, 8, 15, 8, 15, 8, 15, 8, 15, 8]), tvBLoop: 0,
      ...tab('tp', [0, 0, 0, 0, 7, 7, 5, 5, 0, 0, 3, 3, 5, 5, 7, 7]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 118, tabDiv: 3,
      r1Op: 2, r1Step: 0b00011111, r1Div: 2, r1Duty: 0.45,
      fMode: 1, cutoff: 3200, res: 0.2,
      echoFrames: 18, echoFb: 7, echoMix: 0.3, echoPing: 1,
      rvMix: 0.4, rvSize: 0.85, rvDecay: 3.5, volume: 0.51,
    },
  },
  {
    name: 'XOR Bell Sequence', tag: 'seq',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 2, p1Level: 0.4, p1Env: 2, p1Rel: 0.15, p1PTab: 1, p1Pan: -0.3,
      p2Duty: 2, p2Level: 0.4, p2Xor: 1, p2Semi: 7, p2Fine: 4, p2Env: 2, p2Rel: 0.15, p2PTab: 1, p2Pan: 0.3,
      wvLevel: 0.3, wvOct: -1, wvEnv: 2, wvRel: 0.15, wvPTab: 1, ...tab('wv', SINE32),
      ...tab('tvB', [15, 9, 5, 2, 15, 9, 5, 2, 15, 9, 5, 2, 15, 9, 15, 9]), tvBLoop: 0,
      ...tab('tp', [0, 0, 0, 0, 5, 5, 5, 5, 3, 3, 3, 3, 10, 10, 7, 7]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 110, tabDiv: 3,
      fMode: 1, cutoff: 4500, res: 0.15,
      echoFrames: 18, echoFb: 8, echoMix: 0.35, echoPing: 1,
      rvMix: 0.5, rvSize: 1, rvDecay: 5, rvTone: 0.75, volume: 0.46,
    },
  },
  {
    name: 'Acid Table', tag: 'seq',
    values: {
      // one chip voice, a resonant filter and a pitch-table line: hold a note
      mode: 0, clock: 7, precision: 1,
      p1Duty: 4, p1Width: 0.5, p1Level: 0.75, p1Oct: -1, p1Env: 2, p1Rel: 0.06, p1PTab: 1,
      ...tab('tvB', [15, 9, 12, 8, 15, 9, 10, 7, 15, 9, 13, 8, 15, 12, 9, 7]), tvBLoop: 0,
      ...tab('tp', [0, 0, 12, 0, 0, 0, 3, 0, 0, 10, 0, 12, 0, 7, 5, 0]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 126, tabDiv: 6,
      r1Op: 0, r1Step: 3, r1Div: 3, r1Cut: 0.5,
      fMode: 1, cutoff: 900, res: 0.8,
      echoFrames: 18, echoFb: 6, echoMix: 0.25, echoPing: 1,
      rvMix: 0.12, rvDecay: 1, volume: 0.62,
    },
  },
  // ------------------------------------------------------------ drums & perc
  {
    name: 'Deep Kick', tag: 'drum',
    values: {
      // a sine two octaves down, its pitch table falling an octave in a few milliseconds
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 0, p1Level: 0.2, p1Atk: 0.001, p1Dec: 0.015, p1Sus: 0, p1Rel: 0.01,
      wvLevel: 1, wvOct: -2, wvAtk: 0.001, wvDec: 0.4, wvSus: 0, wvRel: 0.2, wvPTab: 1, ...tab('wv', SINE32),
      ...tab('tp', [12, 9, 6, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 240, tabDiv: 1,
      rvMix: 0.04, rvDecay: 0.5, volume: 0.91,
    },
  },
  {
    name: 'Punch Kick', tag: 'drum',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      pdLevel: 0.6, pdShape: 4, pdAmt: 0.5, pdEnvAmt: 1, pdOct: -2, pdAtk: 0.001, pdDec: 0.08, pdSus: 0, pdRel: 0.05, pdPTab: 1,
      wvLevel: 0.9, wvOct: -2, wvAtk: 0.001, wvDec: 0.3, wvSus: 0, wvRel: 0.15, wvPTab: 1, ...tab('wv', SINE32),
      ...tab('tp', [12, 8, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 240, tabDiv: 1,
      lkSpeaker: 0.2, rvMix: 0.04, rvDecay: 0.5, volume: 1,
    },
  },
  {
    name: 'Snare Body', tag: 'drum',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Level: 0,
      nzLevel: 0.85, nzOct: 3, nzMode: 1, nzEnv: 1, nzRel: 0.05,
      ...tab('tvA', [15, 13, 11, 9, 8, 6, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0]),
      wvLevel: 0.6, wvAtk: 0.001, wvDec: 0.09, wvSus: 0, wvRel: 0.05, wvPTab: 1, ...tab('wv', SINE32),
      ...tab('tp', [7, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 120, tabDiv: 1,
      rvMix: 0.25, rvSize: 0.5, rvDecay: 1.2, rvGate: 0.35, rvTone: 0.8, volume: 0.88,
    },
  },
  {
    name: 'Clap Static', tag: 'drum',
    values: {
      // the volume table flutters for the first few steps: several hands, then the room
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Level: 0,
      nzLevel: 0.95, nzOct: 3, nzMode: 1, nzEnv: 1, nzRel: 0.05,
      ...tab('tvA', [15, 3, 14, 2, 13, 11, 9, 8, 6, 5, 4, 3, 2, 1, 1, 0]),
      frameHz: 200, tabDiv: 1,
      fMode: 3, cutoff: 700, res: 0.15,
      rvMix: 0.3, rvSize: 0.5, rvDecay: 1.2, rvGate: 0.3, rvTone: 0.7, volume: 0.88,
    },
  },
  {
    name: 'Closed Hat', tag: 'drum',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Level: 0,
      nzLevel: 1, nzOct: 4, nzMode: 1, nzEnv: 1, nzRel: 0.02,
      ...tab('tvA', [15, 8, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      frameHz: 240, tabDiv: 1,
      fMode: 3, cutoff: 6000, res: 0.15,
      rvMix: 0.06, rvDecay: 0.6, volume: 0.88,
    },
  },
  {
    name: 'Open Hat', tag: 'drum',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Level: 0,
      nzLevel: 1, nzOct: 4, nzMode: 1, nzEnv: 1, nzRel: 0.08,
      ...tab('tvA', [15, 14, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 1, 0]),
      frameHz: 60, tabDiv: 1,
      fMode: 3, cutoff: 5500, res: 0.15,
      rvMix: 0.08, rvDecay: 0.8, volume: 0.75,
    },
  },
  {
    name: 'Metal Ride', tag: 'drum',
    values: {
      // the short LFSR mode is metallic and pitched; two pulses xor-ed add the bell
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Duty: 2, p1Level: 0.25, p1Oct: 2, p1Atk: 0.001, p1Dec: 0.8, p1Sus: 0, p1Rel: 0.6,
      p2Duty: 2, p2Level: 0.25, p2Oct: 2, p2Xor: 1, p2Semi: 6, p2Fine: 30, p2Atk: 0.001, p2Dec: 0.8, p2Sus: 0, p2Rel: 0.6,
      nzLevel: 0.6, nzOct: 4, nzMode: 0, nzAtk: 0.001, nzDec: 1, nzSus: 0, nzRel: 0.8,
      fMode: 3, cutoff: 3500, res: 0.1,
      rvMix: 0.15, rvDecay: 1.4, rvTone: 0.8, volume: 1,
    },
  },
  {
    name: 'Chip Cowbell', tag: 'drum',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 2, p1Level: 0.5, p1Oct: 1, p1Atk: 0.001, p1Dec: 0.3, p1Sus: 0, p1Rel: 0.2,
      p2Duty: 2, p2Level: 0.5, p2Oct: 1, p2Semi: 7, p2Fine: -20, p2Atk: 0.001, p2Dec: 0.3, p2Sus: 0, p2Rel: 0.2,
      fMode: 2, cutoff: 1100, res: 0.45,
      rvMix: 0.1, rvDecay: 0.8, volume: 0.88,
    },
  },
  {
    name: 'Tom Cascade', tag: 'drum',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Level: 0,
      wvLevel: 0.95, wvOct: -1, wvAtk: 0.001, wvDec: 0.45, wvSus: 0, wvRel: 0.3, wvPTab: 1, ...tab('wv', SINE32),
      nzLevel: 0.15, nzOct: 2, nzMode: 1, nzAtk: 0.001, nzDec: 0.04, nzSus: 0, nzRel: 0.03,
      ...tab('tp', [7, 6, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0]), tpLoop: 16,
      frameHz: 120, tabDiv: 1,
      rvMix: 0.25, rvSize: 0.6, rvDecay: 1.5, volume: 0.94,
    },
  },
  {
    name: 'House Machine', tag: 'drum',
    values: {
      // hold one low note: table B kicks on the quarters, table A puts a hat on the off-beats
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4,
      p1Level: 0,
      wvLevel: 1, wvOct: -2, wvEnv: 2, wvRel: 0.05, wvPTab: 1, ...tab('wv', SINE32),
      nzLevel: 0.55, nzOct: 4, nzMode: 0, nzEnv: 1, nzRel: 0.03,
      ...tab('tvB', [15, 9, 4, 1, 0, 0, 0, 0, 15, 9, 4, 1, 0, 0, 0, 0]), tvBLoop: 0,
      ...tab('tvA', [0, 0, 0, 0, 13, 6, 2, 0, 0, 0, 0, 0, 13, 6, 2, 0]), tvALoop: 0,
      ...tab('tp', [7, 2, 0, 0, 0, 0, 0, 0, 7, 2, 0, 0, 0, 0, 0, 0]), tpLoop: 0,
      frameHz: 120, frameSync: 1, tempo: 122, tabDiv: 3,
      fMode: 1, cutoff: 9000, res: 0.1,
      rvMix: 0.1, rvDecay: 0.8, rvGate: 0.3, volume: 0.53,
    },
  },
  {
    name: 'Glitch Perc', tag: 'drum',
    values: {
      // the random arp plays a pitched LFSR click; register 1 throws its pitch about
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.6,
      p1Level: 0,
      nzLevel: 0.9, nzOct: 2, nzMode: 0, nzAtk: 0.001, nzDec: 0.07, nzSus: 0, nzRel: 0.05,
      pdLevel: 0.4, pdShape: 4, pdAmt: 0.8, pdEnvAmt: 1, pdAtk: 0.001, pdDec: 0.05, pdSus: 0, pdRel: 0.04,
      frameHz: 120, frameSync: 1, tempo: 112, arpMode: 4, arpDiv: 6, arpOct: 2, arpGate: 0.3,
      r1Op: 4, r1Step: 77, r1Div: 6, r1Pitch: 1200,
      echoFrames: 9, echoFb: 6, echoMix: 0.25, echoPing: 1,
      rvMix: 0.15, rvDecay: 0.8, rvGate: 0.2, volume: 1,
    },
  },
  // ------------------------------------------------------------------------ fx
  {
    name: 'Riser Array', tag: 'fx',
    values: {
      // hold it: the pitch table climbs a step every two-thirds of a second, register 1 opens the filter
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Duty: 4, p1Width: 0.5, p1Level: 0.25, p1Fine: -15, p1Pan: -0.8, p1Atk: 4, p1Sus: 1, p1Rel: 2, p1PTab: 1,
      p2Duty: 4, p2Width: 0.5, p2Level: 0.25, p2Fine: 15, p2Pan: 0.8, p2Atk: 4, p2Sus: 1, p2Rel: 2, p2PTab: 1,
      nzLevel: 0.35, nzOct: 3, nzMode: 1, nzAtk: 6, nzSus: 1, nzRel: 2,
      ...tab('tp', [-12, -10, -9, -7, -5, -4, -2, 0, 2, 3, 5, 7, 8, 10, 12, 12]), tpLoop: 16,
      frameHz: 12, tabDiv: 8, r1Op: 1, r1Step: 1, r1Div: 1, r1Cut: 0.8,
      fMode: 1, cutoff: 900, res: 0.35,
      echoFrames: 6, echoFb: 9, echoMix: 0.3, echoPing: 1,
      rvMix: 0.6, rvSize: 1, rvDecay: 8, rvTone: 0.6, volume: 0.57,
    },
  },
  {
    name: 'Falling Satellite', tag: 'fx',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Level: 0,
      fmLevel: 0.6, fmRatio: 1.41, fmIndex: 0.4, fmFb: 0.2, fmEnvAmt: 0.4, fmAtk: 0.01, fmDec: 6, fmSus: 0.2, fmRel: 3, fmPTab: 1,
      wvLevel: 0.4, wvFine: 10, wvPan: 0.4, wvAtk: 0.01, wvSus: 1, wvRel: 3, wvPTab: 1, ...tab('wv', BELL32),
      ...tab('tp', [12, 11, 9, 8, 6, 5, 3, 2, 0, -2, -3, -5, -7, -9, -11, -12]), tpLoop: 16,
      frameHz: 16, tabDiv: 4,
      lkDrift: 0.6, lkJitter: 0.2,
      echoFrames: 12, echoFb: 9, echoMix: 0.35, echoPing: 1,
      rvMix: 0.6, rvSize: 1, rvDecay: 9, rvTone: 0.6, volume: 0.43,
    },
  },
  {
    name: 'Laser Zap', tag: 'fx',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Duty: 0, p1Level: 0.6, p1Oct: 1, p1Atk: 0.001, p1Dec: 0.3, p1Sus: 0, p1Rel: 0.1, p1PTab: 1,
      p2Duty: 1, p2Level: 0.4, p2Oct: 1, p2Fine: 20, p2Pan: 0.5, p2Atk: 0.001, p2Dec: 0.3, p2Sus: 0, p2Rel: 0.1, p2PTab: 1,
      ...tab('tp', [12, 9, 6, 3, 0, -3, -6, -9, -12, -12, -12, -12, -12, -12, -12, -12]), tpLoop: 16,
      frameHz: 240, tabDiv: 1,
      echoFrames: 6, echoFb: 8, echoMix: 0.35, echoPing: 1,
      rvMix: 0.2, rvDecay: 1.2, volume: 0.81,
    },
  },
  {
    name: 'Sonar Ping', tag: 'fx',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.5,
      p1Level: 0,
      wvLevel: 0.8, wvOct: 1, wvAtk: 0.001, wvDec: 0.6, wvSus: 0, wvRel: 0.5, ...tab('wv', SINE32),
      fmLevel: 0.2, fmOct: 1, fmRatio: 2.5, fmIndex: 0.1, fmEnvAmt: 1, fmAtk: 0.001, fmDec: 0.3, fmSus: 0, fmRel: 0.3,
      echoFrames: 32, echoFb: 11, echoMix: 0.45, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 8, rvTone: 0.55, volume: 0.61,
    },
  },
  {
    name: 'Modem Dream', tag: 'fx',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Level: 0,
      fmLevel: 0.55, fmRatio: 5.5, fmIndex: 0.35, fmFb: 0.2, fmEnvAmt: 0, fmAtk: 0.5, fmSus: 1, fmRel: 3,
      wvLevel: 0.4, wvOct: -1, wvAtk: 1, wvSus: 1, wvRel: 3, ...tab('wv', WARM32),
      frameHz: 20, r1Op: 4, r1Step: 113, r1Div: 2, r1Pitch: 700, r2Op: 0, r2Step: 3, r2Div: 1, r2Cut: 0.3,
      fMode: 1, cutoff: 2500, res: 0.3,
      lkCodec: 0.5, lkKbps: 24, lkJitter: 0.25,
      echoFrames: 20, echoFb: 9, echoMix: 0.35, echoPing: 1,
      rvMix: 0.65, rvSize: 1, rvDecay: 9, rvTone: 0.45, volume: 0.37,
    },
  },
  {
    name: 'Power Down', tag: 'fx',
    values: {
      // the machine dies: pitch sinks an octave, the clock drifts, packets go missing
      mode: 1, cycle: 0, clock: 5, precision: 1, vel: 0.3,
      p1Duty: 2, p1Level: 0.35, p1Atk: 0.01, p1Sus: 1, p1Rel: 1, p1PTab: 1, p1Pan: -0.4,
      wvLevel: 0.5, wvFine: 8, wvPan: 0.4, wvAtk: 0.01, wvSus: 1, wvRel: 1, wvPTab: 1, ...tab('wv', HOLLOW32),
      ...tab('tp', [0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -10, -11, -11, -12, -12]), tpLoop: 16,
      frameHz: 20, tabDiv: 2,
      lkDrift: 1, lkLoss: 0.3, lkFrame: 12, lkConceal: 2,
      rvMix: 0.45, rvSize: 0.9, rvDecay: 5, rvTone: 0.4, volume: 0.45,
    },
  },
  // ---------------------------------------------------------------- textures
  {
    name: 'Data Rain', tag: 'weird',
    values: {
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4,
      p1Level: 0,
      fmLevel: 0.4, fmRatio: 4, fmIndex: 0.3, fmEnvAmt: 1, fmOct: 1, fmAtk: 0.001, fmDec: 0.3, fmSus: 0, fmRel: 0.4,
      pdLevel: 0.3, pdShape: 3, pdAmt: 0.4, pdEnvAmt: 1, pdOct: 2, pdPan: 0.5, pdAtk: 0.001, pdDec: 0.2, pdSus: 0, pdRel: 0.3,
      frameHz: 120, frameSync: 1, tempo: 100, arpMode: 4, arpDiv: 3, arpOct: 3, arpGate: 0.4,
      lkJitter: 0.15,
      echoFrames: 24, echoFb: 9, echoMix: 0.4, echoPing: 1,
      rvMix: 0.65, rvSize: 1, rvDecay: 8, rvTone: 0.7, volume: 0.56,
    },
  },
  {
    name: 'Swarm Array', tag: 'weird',
    values: {
      // five channels detuned apart and an LFSR on the pitch at 120 Hz: a shimmering swarm
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.3,
      p1Duty: 4, p1Width: 0.4, p1Level: 0.22, p1Fine: -18, p1Pan: -0.9, p1Atk: 1.5, p1Sus: 1, p1Rel: 3,
      p2Duty: 4, p2Width: 0.6, p2Level: 0.22, p2Fine: 18, p2Pan: 0.9, p2Atk: 1.5, p2Sus: 1, p2Rel: 3,
      wvLevel: 0.4, wvFine: -6, wvAtk: 1.5, wvSus: 1, wvRel: 3, ...tab('wv', STRING32),
      pdLevel: 0.25, pdShape: 0, pdAmt: 0.6, pdEnvAmt: 0, pdFine: 9, pdPan: 0.4, pdAtk: 2, pdSus: 1, pdRel: 3,
      fmLevel: 0.2, fmOct: 1, fmFine: -9, fmRatio: 1, fmIndex: 0.15, fmEnvAmt: 0, fmPan: -0.4, fmAtk: 2, fmSus: 1, fmRel: 3,
      frameHz: 120, r1Op: 4, r1Step: 91, r1Div: 1, r1Pitch: 14, r2Op: 0, r2Step: 2, r2Div: 1, r2Cut: 0.25,
      fMode: 1, cutoff: 3500, res: 0.2,
      echoFrames: 24, echoFb: 7, echoMix: 0.2, echoPing: 1,
      rvMix: 0.55, rvSize: 1, rvDecay: 6, rvTone: 0.55, volume: 0.5,
    },
  },
  {
    name: 'Frozen Signal', tag: 'weird',
    values: {
      // play a short chord: the plate at ten seconds and a full-feedback echo hold it
      mode: 1, cycle: 0, clock: 7, precision: 1, vel: 0.4,
      p1Level: 0,
      fmLevel: 0.5, fmRatio: 2, fmIndex: 0.15, fmEnvAmt: 0.5, fmPan: -0.4, fmAtk: 0.01, fmDec: 3, fmSus: 0.3, fmRel: 10,
      wvLevel: 0.5, wvFine: 6, wvPan: 0.4, wvAtk: 0.01, wvDec: 3, wvSus: 0.3, wvRel: 10, ...tab('wv', BELL32),
      lkCodec: 0.25, lkKbps: 64,
      echoFrames: 32, echoFb: 12, echoMix: 0.35, echoPing: 1,
      rvMix: 0.7, rvSize: 1, rvDecay: 10, rvTone: 0.6, volume: 0.46,
    },
  },
  {
    name: 'Init', tag: 'init',
    values: {},
  },
];
