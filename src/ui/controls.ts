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

const TICKS = 11;        // the printed scale around a small knob
const SEGMENTS = 31;     // the LED ring around a hero

export class Knob implements Control {
  el: HTMLElement;
  private value: number;
  private arc: SVGPathElement;
  private tip: SVGRectElement;
  private pointer: SVGLineElement;
  private leds: SVGLineElement[] = [];
  private readout: HTMLElement;
  private dragStartY = 0;
  private dragStartNorm = 0;
  private readonly R: number;       // centre
  private readonly r: number;       // arc radius
  private readonly cap: number;     // cap radius

  /** `hero` draws a segmented LED ring instead of a continuous arc. */
  constructor(public def: ParamDef, value: number, private onChange: (v: number) => void, size = 46, private hero = false) {
    this.value = value;
    const el = document.createElement('div');
    el.className = hero ? 'knob hero' : 'knob';
    el.title = def.name;
    el.style.setProperty('--size', `${size}px`);
    const R = size / 2, r = R - 4, cap = hero ? r - 11 : r - 6;
    this.R = R; this.r = r; this.cap = cap;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string | number>) => {
      const n = document.createElementNS(SVG, tag);
      n.setAttribute('class', cls);
      for (const k in attrs) n.setAttribute(k, String(attrs[k]));
      return n;
    };
    const polar = (a: number, rad: number) => [R + Math.cos((a * Math.PI) / 180) * rad, R + Math.sin((a * Math.PI) / 180) * rad];
    const line = (cls: string, a: number, r0: number, r1: number) => {
      const [x1, y1] = polar(a, r0), [x2, y2] = polar(a, r1);
      return make('line', cls, { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2) });
    };
    const parts: SVGElement[] = [];
    if (hero) {
      for (let i = 0; i < SEGMENTS; i++) {
        const led = line('led', START + (SWEEP * i) / (SEGMENTS - 1), r - 4, r + 2);
        this.leds.push(led); parts.push(led);
      }
    } else {
      for (let i = 0; i < TICKS; i++) parts.push(line('tick', START + (SWEEP * i) / (TICKS - 1), r + 3, r + (i % 5 === 0 ? 6 : 4.5)));
      parts.push(make('path', 'track', { d: arcPath(R, R, r, START, START + SWEEP) }));
    }
    const arc = make('path', 'value', {});
    const disc = make('circle', 'disc', { cx: R, cy: R, r: cap });
    const knurl = make('circle', 'knurl', { cx: R, cy: R, r: cap - 1.5 });
    const pointer = make('line', 'pointer', {});
    const tip = make('rect', 'tip', { width: 3, height: 3 });
    svg.append(...parts, disc, knurl, arc, pointer, tip);
    const label = document.createElement('div');
    label.className = 'label'; label.textContent = def.name;
    const readout = document.createElement('div');
    readout.className = 'readout';
    el.append(svg, label, readout);
    this.el = el; this.arc = arc; this.tip = tip; this.pointer = pointer; this.readout = readout;
    this.render();

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

  private render(): void {
    const { R, r, cap, def } = this;
    const t = toNorm(def, this.value);
    const bipolar = def.min < 0 && def.max > 0;
    const t0 = bipolar ? toNorm(def, 0) : 0;
    const a = START + SWEEP * t;
    if (this.hero) {
      // light the segments between the origin and the value
      const lo = Math.min(t0, t), hi = Math.max(t0, t);
      this.leds.forEach((led, i) => {
        const u = i / (SEGMENTS - 1);
        led.classList.toggle('lit', u >= lo - 1e-6 && u <= hi + 1e-6 && (hi - lo > 0.005 || Math.abs(u - t) < 0.02));
      });
    } else {
      const from = START + SWEEP * t0;
      this.arc.setAttribute('d', Math.abs(a - from) < 0.5 ? '' : arcPath(R, R, r, from, a));
    }
    const rad = (a * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // a hard line from inside the cap to its rim, clear of a hero's value
    const inner = this.hero ? 0.8 : 0.25;
    this.pointer.setAttribute('x1', (R + cos * cap * inner).toFixed(2));
    this.pointer.setAttribute('y1', (R + sin * cap * inner).toFixed(2));
    this.pointer.setAttribute('x2', (R + cos * (cap + 1)).toFixed(2));
    this.pointer.setAttribute('y2', (R + sin * (cap + 1)).toFixed(2));
    const tr = this.hero ? r + 5.5 : r;
    this.tip.setAttribute('x', (R + cos * tr - 1.5).toFixed(2));
    this.tip.setAttribute('y', (R + sin * tr - 1.5).toFixed(2));
    this.tip.setAttribute('transform', `rotate(${(a + 45).toFixed(1)} ${(R + cos * tr).toFixed(2)} ${(R + sin * tr).toFixed(2)})`);
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

export interface ControlOptions {
  /** Enums with more choices than this get a dropdown; the default keeps
   * every enum a row (Vector's chords are a dropdown). */
  segLimit?: number;
  /** Knob diameter in px; heroes are drawn larger. */
  size?: number;
  hero?: boolean;
}

export function makeControl(def: ParamDef, value: number, onChange: (v: number) => void, opts: ControlOptions = {}): Control {
  if (def.scale === 'enum') {
    return (def.labels?.length ?? 0) > (opts.segLimit ?? Infinity)
      ? new Picker(def, value, onChange)
      : new Selector(def, value, onChange);
  }
  if (def.scale === 'bool') return new Toggle(def, value, onChange);
  return new Knob(def, value, onChange, opts.size ?? (opts.hero ? 78 : 42), opts.hero);
}
