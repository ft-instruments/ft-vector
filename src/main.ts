import { Synth } from './audio.ts';
import { MidiInput } from './midi.ts';
import { KeyboardView, ComputerKeys, FIRST, LAST } from './keyboard.ts';
import { makeControl, type Control } from './ui/controls.ts';
import { BitRow, AutomatonView, VectorScope, TableGrid } from './ui/terminal.ts';
import { PARAMS, PARAM_BY_ID, PRESETS, defaults, fromNorm, toNorm, type ParamValues } from './dsp/params.ts';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const synth = new Synth();
const values: ParamValues = defaults();
const controls = new Map<string, Control>();

// ---- audio start -----------------------------------------------------------

const startBtn = $<HTMLButtonElement>('#start');
async function startAudio(): Promise<void> {
  if (synth.running) return;
  startBtn.disabled = true;
  startBtn.textContent = 'booting…';
  try {
    await synth.start();
    synth.loadPreset(values);
    startBtn.textContent = `online · ${synth.latencyMs.toFixed(0)} ms`;
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = 'boot';
    console.error(err);
    alert(`Could not start audio: ${(err as Error).message}`);
  }
}
startBtn.addEventListener('click', startAudio);
window.addEventListener('pointerdown', () => void startAudio(), { once: true });
window.addEventListener('keydown', () => void startAudio(), { once: true });

// ---- visuals ---------------------------------------------------------------

const scope = new VectorScope($<HTMLCanvasElement>('#scope'));

// ---- note routing ----------------------------------------------------------

const handler = {
  noteOn(note: number, velocity: number) {
    void startAudio();
    synth.noteOn(note, velocity);
    keyboard.setPressed(note, true);
  },
  noteOff(note: number) {
    synth.noteOff(note);
    keyboard.setPressed(note, false);
  },
  cc(cc: number, value: number) {
    synth.cc(cc, value);
    if (cc === 64) keyboard.setSustain(value >= 64);
  },
  bend(value: number) { synth.bend(value); },
};

const keyboard = new KeyboardView($<HTMLCanvasElement>('#keyboard'), handler);
const octaveLabel = $('#octave');
new ComputerKeys(handler, (o) => (octaveLabel.textContent = `C${o}`));

$<HTMLButtonElement>('#panic').addEventListener('click', () => {
  synth.panic();
  for (let n = FIRST; n <= LAST; n++) keyboard.setPressed(n, false);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
    e.preventDefault(); handler.cc(64, 127);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { e.preventDefault(); handler.cc(64, 0); }
});

// ---- windows ---------------------------------------------------------------

interface Group { title?: string; ids: string[] }
interface PanelSpec {
  title: string; sub?: string; cls: string; span: number; groups: Group[];
  /** which view it lives in */
  tab: string;
  /** channel prefix: the window collapses to one line when the channel is off */
  channel?: string;
  /** extra display elements, placed before the controls */
  extra?: (body: HTMLElement) => void;
  /** a drawn table in this window */
  grid?: { pre: string; label: string; cols: number; min: number; max: number; loopId?: string };
}

const bitRows = { r1: new BitRow('r1'), r2: new BitRow('r2') };
let automaton: AutomatonView | null = null;
const grids = new Map<string, TableGrid>();
const linkLine = document.createElement('div'); linkLine.className = 'readline';

const channelGroups = (pre: string, extra: string[]): Group[] => [
  { title: 'source', ids: [`${pre}Level`, ...extra, `${pre}Oct`, `${pre}Semi`, `${pre}Fine`, `${pre}Pan`] },
  { title: 'envelope', ids: [`${pre}Env`, `${pre}PTab`, `${pre}Atk`, `${pre}Dec`, `${pre}Sus`, `${pre}Rel`] },
];

const LAYOUT: PanelSpec[] = [
  { tab: 'voice', title: 'sys', sub: 'the machine', cls: 'sys', span: 7, groups: [{ ids: ['mode', 'clock', 'precision', 'cycle', 'vel', 'bend', 'glide'] }] },
  { tab: 'motion', title: 'clk', sub: 'frame clock', cls: 'sys', span: 3, groups: [{ ids: ['frameHz', 'frameSync', 'tempo'] }] },
  { tab: 'voice', title: 'chord', sub: 'the 8-bit chord · one key', cls: 'seq', span: 5, groups: [{ ids: ['chord', 'chordSpeed', 'chordDir', 'chordOct'] }] },
  { tab: 'motion', title: 'arp', sub: 'in frames', cls: 'seq', span: 5, groups: [{ ids: ['arpMode', 'arpDiv', 'arpOct', 'arpGate', 'arpHold'] }] },
  { tab: 'motion', title: 'r1', sub: '8-bit register', cls: 'reg', span: 4, extra: (b) => b.append(bitRows.r1.el), groups: [{ ids: ['r1Op', 'r1Step', 'r1Mask', 'r1Div', 'r1Pitch', 'r1Duty', 'r1Level', 'r1Cut'] }] },
  { tab: 'motion', title: 'r2', sub: '8-bit register', cls: 'reg', span: 4, extra: (b) => b.append(bitRows.r2.el), groups: [{ ids: ['r2Op', 'r2Step', 'r2Mask', 'r2Div', 'r2Pitch', 'r2Duty', 'r2Level', 'r2Cut'] }] },
  { tab: 'motion', title: 'ca', sub: 'cellular automaton · 16 cells', cls: 'reg', span: 4, extra: (b) => {
    const c = document.createElement('canvas'); c.className = 'automaton'; b.append(c); automaton = new AutomatonView(c, 16);
  }, groups: [{ ids: ['caRule', 'caDiv', 'caPitch', 'caDuty', 'caLevel', 'caCut'] }] },
  { tab: 'motion', title: 'flt', sub: 'chamberlin svf', cls: 'seq', span: 4, groups: [{ ids: ['fMode', 'cutoff', 'res'] }] },
  { tab: 'voice', channel: 'p1', title: 'pulse 1', sub: 'clock ÷ n', cls: 'chan', span: 6, groups: channelGroups('p1', ['p1Duty', 'p1Width']) },
  { tab: 'voice', channel: 'p2', title: 'pulse 2', sub: 'clock ÷ n', cls: 'chan', span: 6, groups: channelGroups('p2', ['p2Duty', 'p2Width', 'p2Xor']) },
  { tab: 'voice', channel: 'wv', title: 'wave', sub: '32 × 4-bit', cls: 'chan', span: 6, groups: channelGroups('wv', []) },
  { tab: 'voice', channel: 'nz', title: 'noise', sub: '15-bit lfsr', cls: 'chan', span: 6, groups: channelGroups('nz', ['nzMode']) },
  { tab: 'voice', channel: 'fm', title: 'fm', sub: '2 operators', cls: 'glass', span: 6, groups: channelGroups('fm', ['fmRatio', 'fmIndex', 'fmFb', 'fmEnv']) },
  { tab: 'voice', channel: 'pd', title: 'pd', sub: 'phase distortion', cls: 'glass', span: 6, groups: channelGroups('pd', ['pdShape', 'pdAmt', 'pdEnv']) },
  { tab: 'tables', title: 'wavetable', sub: 'draw it', cls: 'tab', span: 3, grid: { pre: 'wv', label: '32 × 4-bit', cols: 32, min: 0, max: 15 }, groups: [] },
  { tab: 'tables', title: 'vol A', sub: 'table envelope', cls: 'tab', span: 3, grid: { pre: 'tvA', label: '16 × 4-bit', cols: 16, min: 0, max: 15, loopId: 'tvALoop' }, groups: [{ ids: ['tvALoop', 'tabDiv'] }] },
  { tab: 'tables', title: 'vol B', sub: 'table envelope', cls: 'tab', span: 3, grid: { pre: 'tvB', label: '16 × 4-bit', cols: 16, min: 0, max: 15, loopId: 'tvBLoop' }, groups: [{ ids: ['tvBLoop'] }] },
  { tab: 'tables', title: 'pitch', sub: 'table, semitones', cls: 'tab', span: 3, grid: { pre: 'tp', label: '16 × ±12', cols: 16, min: -12, max: 12, loopId: 'tpLoop' }, groups: [{ ids: ['tpLoop'] }] },
  { tab: 'link', title: 'echo', sub: 'in frames · 4-bit', cls: 'echo', span: 4, groups: [{ ids: ['echoFrames', 'echoFb', 'echoMix', 'echoPing'] }] },
  { tab: 'link', title: 'link', sub: 'digital transmission', cls: 'link', span: 8, extra: (b) => b.append(linkLine), groups: [
    { title: 'clock', ids: ['lkDrift', 'lkJitter'] },
    { title: 'codec', ids: ['lkCodec', 'lkKbps'] },
    { title: 'packets', ids: ['lkLoss', 'lkFrame', 'lkConceal'] },
    { title: 'words', ids: ['lkBits', 'lkDither', 'lkBer'] },
    { title: 'out', ids: ['lkSpeaker'] },
  ] },
  { tab: 'link', title: 'plate', sub: 'digital reverb · out', cls: 'out', span: 4, groups: [{ ids: ['rvMix', 'rvSize', 'rvDecay', 'rvTone', 'rvGate', 'volume'] }] },
];

const presetSel = $<HTMLSelectElement>('#preset');

function onParam(id: string, v: number): void {
  values[id] = v;
  synth.setParam(id, v);
  presetSel.value = '';
  const def = PARAM_BY_ID[id];
  if (def.tab) grids.get(def.tab)?.set(def.idx!, v);
  if (id.endsWith('Level')) refreshChannels();
  refreshLoops();
}

function refreshChannels(expandOn = false): void {
  for (const [pre, { panel, meta }] of channelPanels) {
    const lvl = values[`${pre}Level`];
    const off = lvl <= 0;
    meta.textContent = off ? 'off' : `level ${lvl.toFixed(2)}`;
    panel.classList.toggle('off', off);
    if (expandOn) panel.classList.toggle('collapsed', off);
  }
}

function refreshLoops(): void {
  for (const spec of LAYOUT) if (spec.grid?.loopId) grids.get(spec.grid.pre)?.setLoop(values[spec.grid.loopId]);
}

// ---- views: four tabs so the whole machine isn't on screen at once
const TABS: { id: string; name: string; hint: string }[] = [
  { id: 'voice', name: 'voice', hint: 'machine · chord · six channels' },
  { id: 'motion', name: 'motion', hint: 'frame clock · registers · automaton · arp · filter' },
  { id: 'tables', name: 'tables', hint: 'wavetable · envelopes · pitch' },
  { id: 'link', name: 'link', hint: 'echo · transmission · plate' },
];
const tabsEl = $('#tabs');
const tabButtons = new Map<string, HTMLButtonElement>();
let currentTab = 'voice';
function showTab(id: string): void {
  currentTab = id;
  for (const [t, b] of tabButtons) b.classList.toggle('on', t === id);
  for (const el of panelsEl.querySelectorAll<HTMLElement>('.win')) el.hidden = el.dataset.tab !== id;
  try { localStorage.setItem('vector.tab', id); } catch { /* ignore */ }
}
for (const t of TABS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tab';
  b.innerHTML = `<span>${t.name}</span><small>${t.hint}</small>`;
  b.addEventListener('click', () => showTab(t.id));
  tabsEl.append(b); tabButtons.set(t.id, b);
}
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
  const i = ['1', '2', '3', '4'].indexOf(e.key);
  if (i >= 0) showTab(TABS[i].id);
});

const panelsEl = $('#panels');
const channelPanels = new Map<string, { panel: HTMLElement; meta: HTMLElement }>();
for (const spec of LAYOUT) {
  const panel = document.createElement('section');
  panel.className = `win ${spec.cls}`;
  panel.style.gridColumn = `span ${spec.span}`;
  panel.dataset.tab = spec.tab;
  const h = document.createElement('h2');
  h.textContent = spec.title;
  if (spec.sub) { const s = document.createElement('small'); s.textContent = spec.sub; h.append(s); }
  if (spec.channel) {
    // channels fold to one line; the header shows the level and toggles
    const meta = document.createElement('span'); meta.className = 'meta';
    h.append(meta);
    h.classList.add('fold');
    h.addEventListener('click', () => panel.classList.toggle('collapsed'));
    channelPanels.set(spec.channel, { panel, meta });
  }
  const body = document.createElement('div');
  body.className = 'body';
  spec.extra?.(body);
  if (spec.grid) {
    const g = spec.grid;
    const initial: number[] = [];
    for (let i = 0; i < g.cols; i++) initial.push(values[`${g.pre}${i}`]);
    const grid = new TableGrid(g.label, g.cols, g.min, g.max, initial, (i, v) => onParam(`${g.pre}${i}`, v), g.cols === 32 ? 'wide' : '');
    grids.set(g.pre, grid);
    body.append(grid.el);
    // each cell is a parameter; register a tiny control so preset loads reach the grid
    for (let i = 0; i < g.cols; i++) {
      const id = `${g.pre}${i}`;
      controls.set(id, { el: grid.el, def: PARAM_BY_ID[id], set: (v) => grid.set(i, v) });
    }
  }
  for (const g of spec.groups) {
    let host: HTMLElement = body;
    if (g.title) {
      const sg = document.createElement('div'); sg.className = 'subgroup';
      const t = document.createElement('div'); t.className = 'title'; t.textContent = g.title;
      const row = document.createElement('div'); row.className = 'row';
      sg.append(t, row); body.append(sg); host = row;
    }
    for (const id of g.ids) {
      const def = PARAM_BY_ID[id];
      if (!def) { console.warn('unknown param', id); continue; }
      const c = makeControl(def, values[id], (v) => onParam(id, v));
      controls.set(id, c);
      host.append(c.el);
    }
  }
  panel.append(h, body);
  panelsEl.append(panel);
}

// ---- presets ---------------------------------------------------------------

const CATEGORY_NAMES: Record<string, string> = {
  chip: 'chip', arp: 'arps', tracker: 'tracker leads', drum: 'drums', pad: 'pads', glass: 'glass', link: 'the link', seq: 'sequences', weird: 'weird', init: 'init',
};
const groups = new Map<string, HTMLOptGroupElement>();
for (const p of PRESETS) {
  let g = groups.get(p.tag);
  if (!g) {
    g = document.createElement('optgroup');
    g.label = CATEGORY_NAMES[p.tag] ?? p.tag;
    groups.set(p.tag, g);
    presetSel.append(g);
  }
  const o = document.createElement('option');
  o.value = p.name; o.textContent = p.name;
  g.append(o);
}
const custom = document.createElement('option');
custom.value = ''; custom.textContent = '(custom)';
presetSel.append(custom);

function applyValues(next: ParamValues): void {
  for (const def of PARAMS) {
    values[def.id] = next[def.id];
    controls.get(def.id)?.set(next[def.id]);
  }
  synth.loadPreset(values);
  refreshLoops();
  refreshChannels(true);
}

function loadPreset(name: string): void {
  const p = PRESETS.find((x) => x.name === name);
  if (!p) return;
  applyValues({ ...defaults(), ...p.values } as ParamValues);
  presetSel.value = name;
  try { localStorage.setItem('vector.preset', name); } catch { /* private mode */ }
}
presetSel.addEventListener('change', () => loadPreset(presetSel.value));
const stepPreset = (d: number) => {
  const i = PRESETS.findIndex((p) => p.name === presetSel.value);
  loadPreset(PRESETS[(i + d + PRESETS.length) % PRESETS.length].name);
};
$('#prev').addEventListener('click', () => stepPreset(-1));
$('#next').addEventListener('click', () => stepPreset(1));

// "mutate": nudge a handful of continuous parameters, and flip a register op now and then
$('#spore').addEventListener('click', () => {
  const pool = PARAMS.filter((p) => (p.scale === 'lin' || p.scale === 'log') && p.id !== 'volume' && p.id !== 'tempo');
  const next = { ...values };
  for (let i = 0; i < 8; i++) {
    const def = pool[Math.floor(Math.random() * pool.length)];
    const t = toNorm(def, next[def.id]) + (Math.random() - 0.5) * 0.25;
    next[def.id] = fromNorm(def, t);
  }
  if (Math.random() < 0.3) next.r1Step = 1 + Math.floor(Math.random() * 255);
  if (Math.random() < 0.3) next.caRule = Math.floor(Math.random() * 256);
  applyValues(next);
  presetSel.value = '';
});

$('#copy').addEventListener('click', async () => {
  const d = defaults();
  const diff: Record<string, number> = {};
  for (const id in values) if (Math.abs(values[id] - d[id]) > 1e-9) diff[id] = Number(values[id].toFixed(4));
  try { await navigator.clipboard.writeText(JSON.stringify(diff)); } catch { console.log(JSON.stringify(diff)); }
});

let startTab = 'voice';
try { startTab = localStorage.getItem('vector.tab') ?? startTab; } catch { /* ignore */ }
showTab(TABS.some((t) => t.id === startTab) ? startTab : 'voice');

let initial = PRESETS[0].name;
try { initial = localStorage.getItem('vector.preset') ?? initial; } catch { /* ignore */ }
loadPreset(PRESETS.some((p) => p.name === initial) ? initial : PRESETS[0].name);

// ---- MIDI ------------------------------------------------------------------

const midiLed = $('#midi-led');
const midiSel = $<HTMLSelectElement>('#midi-port');
const midi = new MidiInput(handler);
let ledTimer = 0;
midi.onActivity = () => {
  midiLed.classList.add('on');
  clearTimeout(ledTimer);
  ledTimer = window.setTimeout(() => midiLed.classList.remove('on'), 120);
};
midi.onPortsChanged = (ports) => {
  const cur = midiSel.value || 'all';
  midiSel.innerHTML = '<option value="all">all MIDI inputs</option>';
  for (const p of ports) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    midiSel.append(o);
  }
  midiSel.value = ports.some((p) => p.id === cur) ? cur : 'all';
};
midiSel.addEventListener('change', () => midi.select(midiSel.value as string | 'all'));
midi.init().then((ok) => {
  if (!ok) midiSel.innerHTML = `<option>${MidiInput.supported ? 'MIDI denied' : 'no Web MIDI'}</option>`;
});

// ---- stats / the live machine ---------------------------------------------

const stats = $('#stats');
let lastPeak = 0;
synth.onStats = (s) => {
  stats.textContent = `${s.voices} voices · ${Math.round(s.load * 100)}% dsp`;
  const peak = Math.max(s.peakL, s.peakR);
  lastPeak = peak;
  scope.update(s.scope, peak);
  const d = s.display;
  bitRows.r1.set(d[0]); bitRows.r2.set(d[1]);
  automaton?.push(d[2] | (d[3] << 8));
  const playing = s.voices > 0;
  grids.get('tvA')?.setPlayhead(playing ? d[4] : -1);
  grids.get('tvB')?.setPlayhead(playing ? d[4] : -1);
  grids.get('tp')?.setPlayhead(playing ? d[5] : -1);
  linkLine.textContent = `tick ${String(d[7]).padStart(3, '0')} · packet ${d[8] ? 'LOST' : 'ok  '} · codec ${values.lkCodec > 0 ? `${d[9]}/256 coef` : 'off'} · ${(values.lkBits | 0)}-bit`;
  linkLine.classList.toggle('alert', d[8] === 1);
};
// expose for the headless check
(window as unknown as { __vector: unknown }).__vector = { synth, values, peak: () => lastPeak, loadPreset };
