import { Synth } from './audio.ts';
import { MidiInput } from './midi.ts';
import { KeyboardView, ComputerKeys, FIRST, LAST } from './keyboard.ts';
import { makeControl, type Control } from './ui/controls.ts';
import { BitRow, AutomatonView, VectorScope, TableGrid } from './ui/terminal.ts';
import { Viz } from './ui/viz.ts';
import { PARAMS, PARAM_BY_ID, PRESETS, defaults, fromNorm, toNorm, type ParamValues, type Preset } from './dsp/params.ts';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const synth = new Synth();
const values: ParamValues = defaults();
const controls = new Map<string, Control>();

// ---- audio start -----------------------------------------------------------

const startBtn = $<HTMLButtonElement>('#start');
const startLabel = $('#start-label');
let wokeAt = 0;
async function startAudio(): Promise<void> {
  if (synth.running) return;
  startBtn.disabled = true;
  startLabel.textContent = 'booting…';
  try {
    await synth.start();
    synth.loadPreset(values);
    startBtn.disabled = false;
    startBtn.classList.add('on');
    startBtn.title = 'online — click to halt the machine';
    startLabel.textContent = `online · ${synth.latencyMs.toFixed(0)} ms`;
    wokeAt = performance.now();
  } catch (err) {
    startBtn.disabled = false;
    startLabel.textContent = 'boot';
    console.error(err);
    alert(`Could not start audio: ${(err as Error).message}`);
  }
}
/** Put the machine to sleep: notes stop and the audio device is released. */
async function sleepAudio(): Promise<void> {
  synth.panic();
  for (let n = FIRST; n <= LAST; n++) keyboard.setPressed(n, false);
  await synth.suspend();
  startBtn.classList.remove('on');
  startBtn.title = 'boot the machine';
  startLabel.textContent = 'offline';
}
// the power button toggles; playing a note (or any first click) also boots it
startBtn.addEventListener('click', () => {
  if (synth.running) { if (performance.now() - wokeAt > 400) void sleepAudio(); }
  else void startAudio();
});
window.addEventListener('pointerdown', () => void startAudio(), { once: true });
window.addEventListener('keydown', () => void startAudio(), { once: true });

// ---- visuals ---------------------------------------------------------------

const scope = new VectorScope($<HTMLCanvasElement>('#scope'));
const logo = $('.brand h1');
const glitch = () => { logo.classList.remove('glitch'); void logo.offsetWidth; logo.classList.add('glitch'); };

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

const master = $<HTMLInputElement>('#master');
/** The slider's lit part follows its value. */
const setMaster = (v: number) => { master.value = String(v); master.style.setProperty('--fill', `${v * 100}%`); };
master.addEventListener('input', () => {
  const v = Number(master.value);
  master.style.setProperty('--fill', `${v * 100}%`);
  onParam('volume', v);
  controls.get('volume')?.set(v);
});

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

// ---- modules ---------------------------------------------------------------

interface Group {
  title?: string; ids: string[]; cls?: string;
  /** the module's main controls, drawn large */
  hero?: boolean;
}
interface PanelSpec {
  title: string; sub?: string; cls: string; span: number; groups: Group[];
  /** which view it lives in */
  tab: string;
  /** channel prefix: the module folds to one line when the channel is off */
  channel?: string;
  /** the picture drawn at the top of the module (see ui/viz.ts) */
  viz?: string;
  /** extra display elements, placed before the controls */
  extra?: (body: HTMLElement) => void;
  /** a drawn table in this module */
  grid?: { pre: string; label: string; cols: number; min: number; max: number; loopId?: string };
}

const bitRows = { r1: new BitRow('r1'), r2: new BitRow('r2') };
let automaton: AutomatonView | null = null;
const grids = new Map<string, TableGrid>();
const linkLine = document.createElement('div'); linkLine.className = 'readline';

/**
 * A channel: its level and main timbre knobs large, then the rest of the
 * source, then the envelope.
 */
const channelGroups = (pre: string, heroes: string[], extra: string[]): Group[] => [
  { hero: true, ids: [`${pre}Level`, ...heroes] },
  { title: 'source', ids: [...extra, `${pre}Oct`, `${pre}Semi`, `${pre}Fine`, `${pre}Pan`] },
  { title: 'envelope', ids: [`${pre}Env`, `${pre}PTab`, `${pre}Atk`, `${pre}Dec`, `${pre}Sus`, `${pre}Rel`] },
];

const LAYOUT: PanelSpec[] = [
  // ---- voice: the machine and its six channels
  { tab: 'voice', title: 'sys', sub: 'the machine', cls: 'sys', span: 7, viz: 'machine', groups: [{ ids: ['mode', 'clock', 'precision', 'cycle', 'vel', 'bend', 'glide'] }] },
  { tab: 'voice', title: 'chord', sub: 'the 8-bit chord · one key', cls: 'seq', span: 5, viz: 'chord', groups: [{ ids: ['chord', 'chordSpeed', 'chordDir', 'chordOct'] }] },
  { tab: 'voice', channel: 'p1', title: 'pulse 1', sub: 'clock ÷ n', cls: 'chan', span: 6, viz: 'p1', groups: channelGroups('p1', ['p1Width'], ['p1Duty']) },
  { tab: 'voice', channel: 'p2', title: 'pulse 2', sub: 'clock ÷ n', cls: 'chan', span: 6, viz: 'p2', groups: channelGroups('p2', ['p2Width'], ['p2Duty', 'p2Xor']) },
  { tab: 'voice', channel: 'wv', title: 'wave', sub: '32 × 4-bit', cls: 'chan', span: 6, viz: 'wv', groups: channelGroups('wv', [], []) },
  { tab: 'voice', channel: 'nz', title: 'noise', sub: '15-bit lfsr', cls: 'chan', span: 6, viz: 'nz', groups: channelGroups('nz', [], ['nzMode']) },
  { tab: 'voice', channel: 'fm', title: 'fm', sub: '2 operators', cls: 'glass', span: 6, viz: 'fm', groups: channelGroups('fm', ['fmIndex', 'fmRatio'], ['fmFb', 'fmEnv']) },
  { tab: 'voice', channel: 'pd', title: 'pd', sub: 'phase distortion', cls: 'glass', span: 6, viz: 'pd', groups: channelGroups('pd', ['pdAmt'], ['pdShape', 'pdEnv']) },

  // ---- motion: the frame clock and everything it ticks
  { tab: 'motion', title: 'clk', sub: 'frame clock', cls: 'sys', span: 3, viz: 'clock', groups: [{ ids: ['frameHz', 'frameSync', 'tempo'] }] },
  { tab: 'motion', title: 'arp', sub: 'in frames', cls: 'seq', span: 5, viz: 'arp', groups: [{ ids: ['arpMode', 'arpDiv', 'arpOct', 'arpGate', 'arpHold'] }] },
  { tab: 'motion', title: 'flt', sub: 'chamberlin svf', cls: 'seq', span: 4, viz: 'svf', groups: [{ hero: true, ids: ['cutoff', 'res'] }, { ids: ['fMode'] }] },
  { tab: 'motion', title: 'r1', sub: '8-bit register', cls: 'reg', span: 4, extra: (b) => b.append(bitRows.r1.el), groups: [{ ids: ['r1Op', 'r1Step', 'r1Mask', 'r1Div', 'r1Pitch', 'r1Duty', 'r1Level', 'r1Cut'] }] },
  { tab: 'motion', title: 'r2', sub: '8-bit register', cls: 'reg', span: 4, extra: (b) => b.append(bitRows.r2.el), groups: [{ ids: ['r2Op', 'r2Step', 'r2Mask', 'r2Div', 'r2Pitch', 'r2Duty', 'r2Level', 'r2Cut'] }] },
  { tab: 'motion', title: 'ca', sub: 'cellular automaton · 16 cells', cls: 'reg', span: 4, extra: (b) => {
    const c = document.createElement('canvas'); c.className = 'automaton'; b.append(c); automaton = new AutomatonView(c, 16);
  }, groups: [{ ids: ['caRule', 'caDiv', 'caPitch', 'caDuty', 'caLevel', 'caCut'] }] },

  // ---- tables: drawn by hand
  { tab: 'tables', title: 'wavetable', sub: 'draw it', cls: 'tables', span: 3, grid: { pre: 'wv', label: '32 × 4-bit', cols: 32, min: 0, max: 15 }, groups: [] },
  { tab: 'tables', title: 'vol A', sub: 'table envelope', cls: 'tables', span: 3, grid: { pre: 'tvA', label: '16 × 4-bit', cols: 16, min: 0, max: 15, loopId: 'tvALoop' }, groups: [{ ids: ['tvALoop', 'tabDiv'] }] },
  { tab: 'tables', title: 'vol B', sub: 'table envelope', cls: 'tables', span: 3, grid: { pre: 'tvB', label: '16 × 4-bit', cols: 16, min: 0, max: 15, loopId: 'tvBLoop' }, groups: [{ ids: ['tvBLoop'] }] },
  { tab: 'tables', title: 'pitch', sub: 'table, semitones', cls: 'tables', span: 3, grid: { pre: 'tp', label: '16 × ±12', cols: 16, min: -12, max: 12, loopId: 'tpLoop' }, groups: [{ ids: ['tpLoop'] }] },

  // ---- link: the way out
  { tab: 'link', title: 'link', sub: 'digital transmission', cls: 'link wide', span: 12, viz: 'link', extra: (b) => b.append(linkLine), groups: [
    { title: 'clock', ids: ['lkDrift', 'lkJitter'] },
    { title: 'codec', ids: ['lkCodec', 'lkKbps'] },
    { title: 'packets', ids: ['lkLoss', 'lkFrame', 'lkConceal'] },
    { title: 'words', ids: ['lkBits', 'lkDither', 'lkBer'] },
    { title: 'out', ids: ['lkSpeaker'] },
  ] },
  { tab: 'link', title: 'echo', sub: 'in frames · 4-bit', cls: 'echo', span: 6, viz: 'echo', groups: [{ hero: true, ids: ['echoMix', 'echoFb'] }, { ids: ['echoFrames', 'echoPing'] }] },
  { tab: 'link', title: 'plate', sub: 'digital reverb · out', cls: 'out', span: 6, viz: 'plate', groups: [{ hero: true, ids: ['rvMix', 'rvDecay', 'volume'] }, { ids: ['rvSize', 'rvTone', 'rvGate'] }] },
];

const vizzes: Viz[] = [];
const redrawViz = () => { for (const v of vizzes) v.redraw(); };

function onParam(id: string, v: number): void {
  values[id] = v;
  synth.setParam(id, v);
  setCurrent(null);
  const def = PARAM_BY_ID[id];
  if (def.tab) grids.get(def.tab)?.set(def.idx!, v);
  if (id.endsWith('Level')) refreshChannels();
  if (id === 'volume') setMaster(v);
  refreshLoops();
  redrawViz();
}

function refreshChannels(expandOn = false): void {
  for (const [pre, { panel, meta }] of channelPanels) {
    const lvl = values[`${pre}Level`];
    const off = lvl <= 0;
    meta.textContent = off ? 'off' : `lvl ${Math.round(lvl * 100)}`;
    panel.classList.toggle('off', off);
    if (expandOn) panel.classList.toggle('collapsed', off);
  }
}

function refreshLoops(): void {
  for (const spec of LAYOUT) if (spec.grid?.loopId) grids.get(spec.grid.pre)?.setLoop(values[spec.grid.loopId]);
}

const panelsEl = $('#panels');
const channelPanels = new Map<string, { panel: HTMLElement; meta: HTMLElement }>();
for (const spec of LAYOUT) {
  const panel = document.createElement('section');
  panel.className = `panel ${spec.cls}`;
  panel.style.gridColumn = `span ${spec.span}`;
  panel.dataset.tab = spec.tab;
  const head = document.createElement('div');
  head.className = 'head';
  const h = document.createElement('h2');
  h.textContent = spec.title;
  head.append(h);
  if (spec.sub) { const s = document.createElement('small'); s.textContent = spec.sub; head.append(s); }
  if (spec.channel) {
    // channels fold to one line; the header shows the level and toggles
    const meta = document.createElement('span'); meta.className = 'meta';
    head.append(meta);
    head.classList.add('fold');
    head.addEventListener('click', () => panel.classList.toggle('collapsed'));
    channelPanels.set(spec.channel, { panel, meta });
  }
  panel.append(head);
  if (spec.viz) {
    const v = new Viz(spec.viz, values);
    vizzes.push(v);
    panel.append(v.el);
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
    if (g.title || g.hero || g.cls) {
      const sg = document.createElement('div'); sg.className = `subgroup ${g.cls ?? ''} ${g.hero ? 'hero' : ''}`;
      if (g.title) { const t = document.createElement('div'); t.className = 'title'; t.textContent = g.title; sg.append(t); }
      const row = document.createElement('div'); row.className = 'row';
      sg.append(row); body.append(sg); host = row;
    }
    for (const id of g.ids) {
      const def = PARAM_BY_ID[id];
      if (!def) { console.warn('unknown param', id); continue; }
      const c = makeControl(def, values[id], (v) => onParam(id, v), { hero: g.hero });
      controls.set(id, c);
      host.append(c.el);
    }
  }
  panel.append(body);
  panelsEl.append(panel);
}

// ---- views: four tabs so the whole machine isn't on screen at once ---------

const TABS: { id: string; name: string; hint: string }[] = [
  { id: 'voice', name: 'voice', hint: 'machine · chord · six channels' },
  { id: 'motion', name: 'motion', hint: 'clock · arp · filter · registers' },
  { id: 'tables', name: 'tables', hint: 'wavetable · envelopes · pitch' },
  { id: 'link', name: 'link', hint: 'transmission · echo · plate' },
];
const tabsEl = $('#tabs');
const tabLight = tabsEl.querySelector<HTMLElement>('.tab-light')!;
const tabButtons = new Map<string, HTMLButtonElement>();
let shownTab = '';
function placeTabLight(): void {
  const b = tabButtons.get(shownTab);
  if (!b) return;
  tabLight.style.left = `${b.offsetLeft}px`;
  tabLight.style.width = `${b.offsetWidth}px`;
}
function showTab(id: string): void {
  if (id === shownTab) return;
  shownTab = id;
  for (const [t, b] of tabButtons) b.classList.toggle('on', t === id);
  tabsEl.dataset.on = id;
  placeTabLight();
  // the modules of the view come in, one after another
  let i = 0;
  for (const el of panelsEl.querySelectorAll<HTMLElement>('.panel')) {
    const on = el.dataset.tab === id;
    el.hidden = !on;
    el.classList.remove('enter');
    if (on) { void el.offsetWidth; el.style.setProperty('--i', String(i++)); el.classList.add('enter'); }
  }
  redrawViz();
  for (const g of grids.values()) g.draw();
  automaton?.draw();
  try { localStorage.setItem('vector.tab', id); } catch { /* ignore */ }
}
for (const t of TABS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tab';
  b.innerHTML = `<span class="n">0${TABS.indexOf(t) + 1}</span><span class="nm">${t.name}</span><small>${t.hint}</small>`;
  b.addEventListener('click', () => showTab(t.id));
  tabsEl.append(b); tabButtons.set(t.id, b);
}
new ResizeObserver(placeTabLight).observe(tabsEl);

// 1–4 switch view, ` opens the preset browser, Esc closes it
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') { closeBrowser(); return; }
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === '`') { e.preventDefault(); openBrowser(); return; }
  const i = ['1', '2', '3', '4'].indexOf(e.key);
  if (i >= 0) showTab(TABS[i].id);
});

// ---- presets ---------------------------------------------------------------

// Categories, in the order they should appear in the browser. "user" is the
// sounds saved in this browser.
const CATEGORY_NAMES: Record<string, string> = {
  user: 'yours', chip: 'chip', arp: 'arps', tracker: 'tracker leads', drum: 'drums', pad: 'pads', glass: 'glass',
  link: 'the link', seq: 'sequences', weird: 'weird', init: 'init',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_NAMES);
const catRank = (tag: string) => { const i = CATEGORY_ORDER.indexOf(tag); return i < 0 ? CATEGORY_ORDER.length : i; };

// ---- your presets: kept in this browser's storage, as diffs from the defaults
const USER_KEY = 'vector.user-presets';
function readUser(): Preset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_KEY) ?? '[]') as { name: string; values: Partial<ParamValues> }[];
    return raw.filter((p) => typeof p?.name === 'string' && p.values).map((p) => ({ name: p.name, tag: 'user', values: p.values }));
  } catch { return []; }
}
let userPresets = readUser();
function writeUser(): void {
  try { localStorage.setItem(USER_KEY, JSON.stringify(userPresets.map((p) => ({ name: p.name, values: p.values })))); }
  catch { /* private mode: they last until the page closes */ }
}

const allPresets = (): Preset[] => [...userPresets, ...PRESETS];
const findPreset = (name: string | null) => (name ? allPresets().find((x) => x.name === name) : undefined);
let browseOrder: Preset[] = [];
const sortPresets = () => { browseOrder = allPresets().sort((a, b) => catRank(a.tag) - catRank(b.tag)); };
sortPresets();

const nameEl = $('#preset-name');
const tagEl = $('#preset-tag');
let current: string | null = null;
let lastLoaded: string | null = null;

/** Reflect the loaded preset in the header; null means the patch was edited. */
function setCurrent(name: string | null): void {
  if (current === name) return;
  current = name;
  if (name) lastLoaded = name;
  const p = findPreset(name);
  nameEl.textContent = p ? p.name : (lastLoaded ?? 'custom');
  tagEl.textContent = p ? (CATEGORY_NAMES[p.tag] ?? p.tag) : 'edited';
  tagEl.dataset.tag = p ? p.tag : 'edited';
  for (const [n, card] of cards) card.classList.toggle('on', n === name);
}

function applyValues(next: ParamValues): void {
  for (const def of PARAMS) {
    values[def.id] = next[def.id];
    controls.get(def.id)?.set(next[def.id]);
  }
  synth.loadPreset(values);
  refreshLoops();
  refreshChannels(true);
  setMaster(values.volume);
  redrawViz();
}

function loadPreset(name: string): void {
  const p = findPreset(name);
  if (!p) return;
  applyValues({ ...defaults(), ...p.values } as ParamValues);
  current = null;                 // force the header to refresh even for the same name
  setCurrent(name);
  nameEl.classList.remove('swap'); void nameEl.offsetWidth; nameEl.classList.add('swap');
  glitch();
  try { localStorage.setItem('vector.preset', name); } catch { /* private mode */ }
}

const stepPreset = (d: number) => {
  const i = browseOrder.findIndex((p) => p.name === (current ?? lastLoaded));
  loadPreset(browseOrder[(i + d + browseOrder.length) % browseOrder.length].name);
};
$('#prev').addEventListener('click', () => stepPreset(-1));
$('#next').addEventListener('click', () => stepPreset(1));

/** The current sound as a diff from the defaults: what a preset stores. */
function patchDiff(): Partial<ParamValues> {
  const d = defaults();
  const diff: Partial<ParamValues> = {};
  for (const id in values) if (Math.abs(values[id] - d[id]) > 1e-9) diff[id] = Number(values[id].toFixed(4));
  return diff;
}

// ---- the browser -----------------------------------------------------------

const browserEl = $('#browser');
const listEl = $('#browser-list');
const sideEl = $('#browser-side');
const searchEl = $<HTMLInputElement>('#browser-search');
const cards = new Map<string, HTMLButtonElement>();
const heads = new Map<string, HTMLElement>();

/** (Re)build the list and the sidebar from the factory bank and yours. */
function buildBrowser(): void {
  listEl.replaceChildren(); sideEl.replaceChildren(); cards.clear(); heads.clear();
  const counts = new Map<string, number>();
  for (const p of browseOrder) counts.set(p.tag, (counts.get(p.tag) ?? 0) + 1);
  if (!userPresets.length) {
    // keep a place for them, so saving has somewhere to land
    const h = document.createElement('div'); h.className = 'cat'; h.dataset.tag = 'user'; h.textContent = CATEGORY_NAMES.user;
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = 'nothing saved yet — shape a sound, then “save current” (⌘S)';
    listEl.append(h, empty); heads.set('user', h);
    counts.set('user', 0);
  }
  for (const tag of [...new Set(['user', ...browseOrder.map((p) => p.tag)])]) {
    const s = document.createElement('button');
    s.type = 'button'; s.dataset.tag = tag;
    s.innerHTML = '<span class="nm"></span><span class="count"></span>';
    s.querySelector('.nm')!.textContent = CATEGORY_NAMES[tag] ?? tag;
    s.querySelector('.count')!.textContent = String(counts.get(tag) ?? 0);
    s.addEventListener('click', () => {
      if (searchEl.value) { searchEl.value = ''; filterBrowser(); }
      heads.get(tag)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    sideEl.append(s);
  }
  let lastTag = '';
  for (const p of browseOrder) {
    if (p.tag !== lastTag) {
      lastTag = p.tag;
      const h = document.createElement('div');
      h.className = 'cat'; h.dataset.tag = p.tag;
      h.textContent = CATEGORY_NAMES[p.tag] ?? p.tag;
      listEl.append(h); heads.set(p.tag, h);
    }
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'card'; card.dataset.tag = p.tag;
    card.dataset.search = `${p.name} ${CATEGORY_NAMES[p.tag] ?? p.tag}`.toLowerCase();
    card.innerHTML = `<span class="nm"></span><span class="tg"></span>`;
    card.querySelector<HTMLElement>('.nm')!.textContent = p.name;
    card.querySelector<HTMLElement>('.tg')!.textContent = CATEGORY_NAMES[p.tag] ?? p.tag;
    card.addEventListener('click', () => { loadPreset(p.name); closeBrowser(); });
    if (p.tag === 'user') {
      // yours can be deleted: one click arms it, the second deletes
      const del = document.createElement('span');
      del.className = 'del'; del.title = 'delete'; del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'delete?'; return; }
        userPresets = userPresets.filter((x) => x.name !== p.name);
        writeUser(); sortPresets(); buildBrowser(); filterBrowser();
        if (current === p.name) setCurrent(null);
      });
      del.addEventListener('mouseleave', () => { del.classList.remove('armed'); del.textContent = '×'; });
      card.append(del);
    }
    card.classList.toggle('on', p.name === current);
    listEl.append(card);
    cards.set(p.name, card);
  }
}
buildBrowser();

function filterBrowser(): void {
  const q = searchEl.value.trim().toLowerCase();
  // while searching, results come from several categories at once, so each
  // card names its own; otherwise the heading above it already does
  listEl.classList.toggle('searching', q.length > 0);
  let shownInCat = 0;
  let cat: HTMLElement | null = null;
  for (const el of listEl.children as HTMLCollectionOf<HTMLElement>) {
    if (el.classList.contains('cat')) {
      if (cat) cat.hidden = shownInCat === 0 && !!q;
      cat = el; shownInCat = 0;
      continue;
    }
    const hit = !q || (el.dataset.search ?? '').includes(q);
    el.hidden = !hit;
    if (hit) shownInCat++;
  }
  if (cat) cat.hidden = shownInCat === 0 && !!q;
}

// ---- saving: name the current sound
const saveBar = $<HTMLFormElement>('#savebar');
const saveName = $<HTMLInputElement>('#save-name');
const saveOk = $<HTMLButtonElement>('#save-ok');
const saveMsg = $('#save-msg');

function checkName(): 'new' | 'overwrite' | 'taken' | 'empty' {
  const n = saveName.value.trim();
  if (!n) return 'empty';
  if (PRESETS.some((p) => p.name.toLowerCase() === n.toLowerCase())) return 'taken';
  return userPresets.some((p) => p.name.toLowerCase() === n.toLowerCase()) ? 'overwrite' : 'new';
}
function refreshSave(): void {
  const s = checkName();
  saveOk.textContent = s === 'overwrite' ? 'overwrite' : 'save';
  saveOk.disabled = s === 'empty' || s === 'taken';
  saveMsg.textContent = s === 'taken' ? 'a factory preset has that name' : s === 'overwrite' ? 'replaces your sound with that name' : '';
}
function openSave(): void {
  if (browserEl.hidden) openBrowser();
  saveBar.hidden = false;
  const base = findPreset(lastLoaded);
  saveName.value = base?.tag === 'user' ? base.name : current ? '' : (lastLoaded ? `${lastLoaded} (mine)` : '');
  refreshSave();
  saveName.focus(); saveName.select();
}
function closeSave(): void { saveBar.hidden = true; }
saveName.addEventListener('input', refreshSave);
saveBar.addEventListener('submit', (e) => {
  e.preventDefault();
  const s = checkName();
  if (s === 'empty' || s === 'taken') return;
  const name = saveName.value.trim();
  const p: Preset = { name, tag: 'user', values: patchDiff() };
  const i = userPresets.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) userPresets[i] = p; else userPresets.push(p);
  userPresets.sort((a, b) => a.name.localeCompare(b.name));
  writeUser(); sortPresets(); buildBrowser();
  closeSave(); closeBrowser();
  current = null; setCurrent(name);
  nameEl.classList.remove('swap'); void nameEl.offsetWidth; nameEl.classList.add('swap');
  try { localStorage.setItem('vector.preset', name); } catch { /* private mode */ }
});
$('#save-cancel').addEventListener('click', closeSave);
$('#browser-save').addEventListener('click', openSave);
$('#save').addEventListener('click', openSave);
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); openSave(); }
});

function openBrowser(): void {
  browserEl.hidden = false;
  closeSave();
  searchEl.value = '';
  filterBrowser();
  searchEl.focus();
  cards.get(current ?? lastLoaded ?? '')?.scrollIntoView({ block: 'center' });
}
function closeBrowser(): void { browserEl.hidden = true; closeSave(); }

$('#browse').addEventListener('click', openBrowser);
$('#browser-close').addEventListener('click', closeBrowser);
browserEl.addEventListener('click', (e) => { if (e.target === browserEl) closeBrowser(); });
searchEl.addEventListener('input', filterBrowser);
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = [...listEl.querySelectorAll<HTMLButtonElement>('.card')].find((c) => !c.hidden);
    if (first) first.click();
  }
});

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
  setCurrent(null);
  glitch();
});

$('#copy').addEventListener('click', async () => {
  const diff = patchDiff();
  try { await navigator.clipboard.writeText(JSON.stringify(diff)); } catch { console.log(JSON.stringify(diff)); }
  const b = $('#copy');
  b.classList.add('done');
  setTimeout(() => b.classList.remove('done'), 1200);
});

let startTab = 'voice';
try { startTab = localStorage.getItem('vector.tab') ?? startTab; } catch { /* ignore */ }
showTab(TABS.some((t) => t.id === startTab) ? startTab : 'voice');

let initial = browseOrder.find((p) => p.tag !== 'user')!.name;
try { initial = localStorage.getItem('vector.preset') ?? initial; } catch { /* ignore */ }
loadPreset(findPreset(initial) ? initial : PRESETS[0].name);

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
