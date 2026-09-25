// Parameter widgets: rotary knob (drag / wheel / double-click reset),
// segmented selector for enums, toggle for booleans. Each renders into a
// DOM element and calls back with the new value.

import { fromNorm, toNorm, format, type ParamDef } from '../dsp/params.ts';

export interface Control {
  el: HTMLElement;
  def: ParamDef;
  set(value: number): void;
}

const SVG = 'http://www.w3.org/2000/svg';
const SWEEP = 270;                       // degrees of travel
const START = 135;                       // degrees from +x axis, clockwise... (svg coords)

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class Knob implements Control {
  el: HTMLElement;
  private value: number;
  private arc: SVGPathElement;
  private pointer: SVGLineElement;
  private readout: HTMLElement;
  private dragStartY = 0;
  private dragStartNorm = 0;

  constructor(public def: ParamDef, value: number, private onChange: (v: number) => void, size = 54) {
    this.value = value;
    const el = document.createElement('div');
    el.className = 'knob';
    el.title = def.name;
    const R = size / 2, r = R - 5;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
    // growth-ring track
    const track = document.createElementNS(SVG, 'path');
    track.setAttribute('class', 'track');
    track.setAttribute('d', arcPath(R, R, r, START, START + SWEEP));
    const ring2 = document.createElementNS(SVG, 'circle');
    ring2.setAttribute('class', 'ring'); ring2.setAttribute('cx', String(R)); ring2.setAttribute('cy', String(R)); ring2.setAttribute('r', String(r - 6));
    const disc = document.createElementNS(SVG, 'circle');
    disc.setAttribute('class', 'disc'); disc.setAttribute('cx', String(R)); disc.setAttribute('cy', String(R)); disc.setAttribute('r', String(r - 8));
    const arc = document.createElementNS(SVG, 'path');
    arc.setAttribute('class', 'value');
    const pointer = document.createElementNS(SVG, 'line');
    pointer.setAttribute('class', 'pointer');
    svg.append(track, ring2, disc, arc, pointer);
    const label = document.createElement('div');
    label.className = 'label'; label.textContent = def.name;
    const readout = document.createElement('div');
    readout.className = 'readout';
    el.append(svg, label, readout);
    this.el = el; this.arc = arc; this.pointer = pointer; this.readout = readout;
    this.render(size);

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      this.dragStartY = e.clientY;
      this.dragStartNorm = toNorm(def, this.value);
      el.classList.add('active');
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const range = e.shiftKey ? 1200 : 220;
      const t = this.dragStartNorm + (this.dragStartY - e.clientY) / range;
      this.apply(fromNorm(def, t));
    });
    const end = (e: PointerEvent) => { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); el.classList.remove('active'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => this.apply(def.def));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const t = toNorm(def, this.value) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03);
      this.apply(fromNorm(def, t));
    }, { passive: false });
  }

  private apply(v: number): void {
    v = Math.min(this.def.max, Math.max(this.def.min, v));
    if (v === this.value) return;
    this.value = v;
    this.render();
    this.onChange(v);
  }

  set(value: number): void { this.value = value; this.render(); }

  private render(size = 54): void {
    const R = size / 2, r = R - 5;
    const def = this.def;
    const t = toNorm(def, this.value);
    const bipolar = def.min < 0 && def.max > 0;
    const a = START + SWEEP * t;
    const from = bipolar ? START + SWEEP * toNorm(def, 0) : START;
    this.arc.setAttribute('d', Math.abs(a - from) < 0.5 ? '' : arcPath(R, R, r, from, a));
    const rad = (a * Math.PI) / 180;
    this.pointer.setAttribute('x1', String((R + Math.cos(rad) * (r - 16)).toFixed(2)));
    this.pointer.setAttribute('y1', String((R + Math.sin(rad) * (r - 16)).toFixed(2)));
    this.pointer.setAttribute('x2', String((R + Math.cos(rad) * (r - 8)).toFixed(2)));
    this.pointer.setAttribute('y2', String((R + Math.sin(rad) * (r - 8)).toFixed(2)));
    this.readout.textContent = format(def, this.value);
  }
}

export class Selector implements Control {
  el: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private value: number;

  constructor(public def: ParamDef, value: number, private onChange: (v: number) => void) {
    this.value = value;
    const el = document.createElement('div');
    el.className = 'selector';
    const label = document.createElement('div');
    label.className = 'label'; label.textContent = def.name;
    const row = document.createElement('div');
    row.className = 'seg';
    (def.labels ?? []).forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = name;
      b.addEventListener('click', () => { this.value = i; this.render(); onChange(i); });
      row.append(b);
      this.buttons.push(b);
    });
    el.append(label, row);
    this.el = el;
    this.render();
  }

  set(value: number): void { this.value = value; this.render(); }

  private render(): void {
    this.buttons.forEach((b, i) => b.classList.toggle('on', i === Math.round(this.value)));
  }
}

export class Toggle implements Control {
  el: HTMLElement;
  private btn: HTMLButtonElement;
  private value: number;

  constructor(public def: ParamDef, value: number, private onChange: (v: number) => void) {
    this.value = value;
    const el = document.createElement('div');
    el.className = 'toggle';
    const label = document.createElement('div');
    label.className = 'label'; label.textContent = def.name;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.addEventListener('click', () => { this.value = this.value >= 0.5 ? 0 : 1; this.render(); onChange(this.value); });
    el.append(btn, label);
    this.el = el; this.btn = btn;
    this.render();
  }

  set(value: number): void { this.value = value; this.render(); }

  private render(): void {
    const on = this.value >= 0.5;
    this.btn.classList.toggle('on', on);
    this.btn.textContent = on ? 'on' : 'off';
  }
}

/**
 * A dropdown, for enums with more choices than fit in a segmented row (the
 * modulation matrix's sources and destinations).
 */
export class Picker implements Control {
  el: HTMLElement;
  private sel: HTMLSelectElement;

  constructor(public def: ParamDef, value: number, onChange: (v: number) => void) {
    const el = document.createElement('div');
    el.className = 'picker';
    const label = document.createElement('div');
    label.className = 'label'; label.textContent = def.name;
    const sel = document.createElement('select');
    (def.labels ?? []).forEach((name, i) => {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = name;
      sel.append(o);
    });
    sel.addEventListener('change', () => onChange(Number(sel.value)));
    el.append(label, sel);
    this.el = el; this.sel = sel;
    this.set(value);
  }

  set(value: number): void {
    this.sel.value = String(Math.round(value));
    this.el.classList.toggle('off', Math.round(value) === 0 && this.def.id.endsWith('Src'));
  }
}

/**
 * Enums keep the segmented row unless they have more than `segLimit`
 * choices, in which case they get a dropdown. The default keeps every enum a
 * row (Siege's bodies, Vector's chords); Mycelia passes 8 for its matrix.
 */
export function makeControl(def: ParamDef, value: number, onChange: (v: number) => void, segLimit = Infinity): Control {
  if (def.scale === 'enum') {
    return (def.labels?.length ?? 0) > segLimit
      ? new Picker(def, value, onChange)
      : new Selector(def, value, onChange);
  }
  if (def.scale === 'bool') return new Toggle(def, value, onChange);
  return new Knob(def, value, onChange);
}
