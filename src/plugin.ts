// The UI's handle on the synth when the page runs inside the plugin's
// WebView instead of a browser tab. Same surface as Synth (audio.ts), but
// every call goes to the C++ side (plugin/Source/PluginEditor.cpp) over
// JUCE's event bridge, and parameter changes become host parameters.

import type { WorkletStats, WorkletNote } from './worklet/processor.ts';
import type { ParamId, ParamValues } from './dsp/params.ts';

interface JuceBackend {
  emitEvent(id: string, payload: unknown): void;
  addEventListener(id: string, fn: (payload: unknown) => void): unknown;
}

const backend = (): JuceBackend | undefined =>
  (window as unknown as { __JUCE__?: { backend?: JuceBackend } }).__JUCE__?.backend;

/**
 * The size the page is laid out at inside the plugin: the width of the full
 * desktop layout, and the height of its tallest view with the channels
 * folded (link). The page is scaled as a whole to fit the editor window; the
 * editor's default size keeps this aspect (PluginEditor.cpp). The voice view
 * with several channels open is taller and scrolls, as it does in a browser.
 */
export const UI_W = 1360, UI_H = 850;

/** Scale the laid-out page to the window, centred when the window is wider than the design. */
function fitToWindow(): void {
  const s = Math.min(window.innerWidth / UI_W, window.innerHeight / UI_H);
  const root = document.documentElement.style;
  root.setProperty('--ui-w', `${UI_W}px`);
  root.setProperty('--ui-scale', String(s));
  root.setProperty('--ui-x', `${Math.max(0, (window.innerWidth - UI_W * s) / 2)}px`);
}

/** A transform doesn't change the layout, so tell the CSS the page's height: it trims the scroll range to the scaled page. */
function trackHeight(): void {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) return;
  const set = () => document.documentElement.style.setProperty('--ui-h', `${app.offsetHeight}px`);
  new ResizeObserver(set).observe(app);
  set();
}

/** Dev only (`npm run dev`, then open /?plugin): lay the page out as the plugin does, in a browser tab. Audio stays the browser's. */
export function previewPluginLayout(): void {
  document.documentElement.classList.add('in-plugin', 'preview');
  fitToWindow();
  trackHeight();
  window.addEventListener('resize', fitToWindow);
}

/** True when the page is the plugin's editor. */
export const inPlugin = (): boolean => backend() !== undefined;

export interface StoredPreset { name: string; values: Partial<ParamValues>; v?: number }

/** Everything the page needs when it opens (or when the host swaps the sound under it). */
export interface PluginState {
  values: ParamValues;
  preset: string;
  last: string;
  /** your presets, as stored in the plugin's file (parsed by the page) */
  user: unknown;
}

/** A note from the host's MIDI: kind 0 on, 1 off (2, the arp, goes to onNote). */
export type HostNote = [note: number, velocity: number, kind: 0 | 1 | 2];

type FromPlugin =
  | { type: 'state'; values: ParamValues; preset: string; last: string; user: unknown }
  | { type: 'params'; values: Partial<ParamValues> }
  | { type: 'notes'; list: HostNote[] }
  | { type: 'stats'; voices: number; load: number; peakL: number; peakR: number; tempo: number; scope: number[]; display: number[] };

export class PluginSynth {
  public onStats: ((s: WorkletStats & { tempo: number }) => void) | null = null;
  /** Notes the arp played (velocity 0..1, as from the worklet). */
  public onNote: ((n: WorkletNote) => void) | null = null;
  public onState: ((s: PluginState) => void) | null = null;
  /** Parameters the host moved (automation, its own editor). */
  public onParams: ((values: Partial<ParamValues>) => void) | null = null;
  public onHostNotes: ((notes: HostNote[]) => void) | null = null;

  constructor() {
    backend()!.addEventListener('vector', (m) => this.receive(m as FromPlugin));
    fitToWindow();
    trackHeight();
    window.addEventListener('resize', fitToWindow);
  }

  /** The host owns the audio device: the synth is always awake. */
  get running(): boolean { return true; }
  async start(): Promise<void> { /* nothing to wake */ }
  async suspend(): Promise<void> { this.panic(); }
  get latencyMs(): number { return 0; }

  /** Ask for the current state; the answer arrives through onState. */
  ready(): void { this.send({ type: 'ready' }); }

  noteOn(note: number, velocity: number): void { this.send({ type: 'noteOn', note, velocity }); }
  noteOff(note: number): void { this.send({ type: 'noteOff', note }); }
  cc(cc: number, value: number): void { this.send({ type: 'cc', cc, value }); }
  bend(value: number): void { this.send({ type: 'bend', value }); }
  setParam(id: ParamId, value: number): void { this.send({ type: 'param', id, value }); }
  setParams(values: Partial<ParamValues>): void { for (const id in values) this.setParam(id, values[id]!); }
  loadPreset(values: Partial<ParamValues>): void { this.send({ type: 'preset', values, name: '' }); }
  panic(): void { this.send({ type: 'panic' }); }

  /** The preset the header shows ('' once the sound is edited), kept with the session. */
  setCurrent(name: string | null): void { this.send({ type: 'current', name: name ?? '' }); }
  /** Your presets live in a file next to the plugin's other settings, shared by every instance. */
  saveUser(presets: StoredPreset[]): void { this.send({ type: 'saveUser', presets }); }

  private send(payload: Record<string, unknown>): void { backend()?.emitEvent('vector', payload); }

  private receive(m: FromPlugin): void {
    switch (m.type) {
      case 'state':
        this.onState?.({ values: m.values, preset: m.preset, last: m.last, user: m.user });
        break;
      case 'params': this.onParams?.(m.values); break;
      case 'notes': {
        const host = m.list.filter((n) => n[2] !== 2);
        if (host.length) this.onHostNotes?.(host);
        for (const [note, velocity, kind] of m.list) if (kind === 2) this.onNote?.({ type: 'note', note, velocity: velocity / 127 });
        break;
      }
      case 'stats':
        this.onStats?.({
          type: 'stats', voices: m.voices, load: m.load, peakL: m.peakL, peakR: m.peakR,
          scope: Float32Array.from(m.scope), display: Uint8Array.from(m.display), tempo: m.tempo,
        });
        break;
    }
  }
}
