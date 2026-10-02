// On-screen 5-octave keyboard (canvas) with mouse/touch input, plus a
// computer-keyboard mapping. Shared by the whole family: the look comes from
// CSS custom properties on the canvas (--key-rgb, --key-alt-rgb,
// --key-white-a, --key-white-b, --key-black, --mono), so each instrument
// themes it without touching this file.

export interface KeyboardHandler {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
}

export const FIRST = 36, LAST = 96;
const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (n: number) => BLACK.has(n % 12);

export class KeyboardView {
  private ctx: CanvasRenderingContext2D;
  private down = new Set<number>();
  private glow = new Map<number, number>();     // note -> glow 0..1 fading out
  private pointerNote = new Map<number, number>();
  private whiteCount = 0;
  private whiteIndex: number[] = [];
  private held = false;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement, private handler: KeyboardHandler) {
    this.ctx = canvas.getContext('2d')!;
    let wi = 0;
    for (let n = 0; n <= LAST; n++) {
      this.whiteIndex[n] = wi;
      if (n >= FIRST && !isBlack(n)) wi++;
    }
    this.whiteCount = wi;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setPressed(note: number, on: boolean): void {
    if (on) { this.down.add(note); this.glow.set(note, 1); } else this.down.delete(note);
    this.animate();
  }

  setSustain(on: boolean): void { this.held = on; this.draw(); }

  private animate(): void {
    if (this.raf) return;
    const step = () => {
      this.raf = 0;
      let alive = false;
      for (const [n, g] of this.glow) {
        if (this.down.has(n)) { alive = true; continue; }
        const ng = g - 0.06;
        if (ng <= 0) this.glow.delete(n); else { this.glow.set(n, ng); alive = true; }
      }
      this.draw();
      if (alive) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };   // layout size: the plugin scales the page
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private noteAt(x: number, y: number): { note: number; velocity: number } | null {
    const r = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    const ww = r.width / this.whiteCount;
    const h = r.height;
    if (x < 0 || x >= r.width || y < 0 || y >= h) return null;
    if (y < h * 0.6) {
      for (let n = FIRST; n <= LAST; n++) {
        if (!isBlack(n)) continue;
        const cx = this.whiteIndex[n] * ww;
        const bw = ww * 0.58;
        if (x >= cx - bw / 2 && x < cx + bw / 2) return { note: n, velocity: this.vel(y, h * 0.6) };
      }
    }
    const idx = Math.floor(x / ww);
    let wi = 0;
    for (let n = FIRST; n <= LAST; n++) {
      if (isBlack(n)) continue;
      if (wi === idx) return { note: n, velocity: this.vel(y, h) };
      wi++;
    }
    return null;
  }

  private vel(y: number, keyHeight: number): number {
    return Math.round(40 + 87 * Math.min(1, Math.max(0, y / keyHeight)));
  }

  private onDown(e: PointerEvent): void {
    const hit = this.noteAt(e.offsetX, e.offsetY);
    if (!hit) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointerNote.set(e.pointerId, hit.note);
    this.handler.noteOn(hit.note, hit.velocity);
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    const cur = this.pointerNote.get(e.pointerId);
    if (cur === undefined) return;
    const hit = this.noteAt(e.offsetX, e.offsetY);
    if (!hit || hit.note === cur) return;
    this.handler.noteOff(cur);
    this.pointerNote.set(e.pointerId, hit.note);
    this.handler.noteOn(hit.note, hit.velocity);
  }

  private onUp(e: PointerEvent): void {
    const cur = this.pointerNote.get(e.pointerId);
    if (cur === undefined) return;
    this.pointerNote.delete(e.pointerId);
    this.handler.noteOff(cur);
  }

  draw(): void {
    const ctx = this.ctx;
    const css = getComputedStyle(this.canvas);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const ph = v('--key-rgb', '120,255,200');        // white keys, labels
    const mg = v('--key-alt-rgb', '255,90,220');     // black keys, sustain
    const whiteA = v('--key-white-a', '#0c1a14'), whiteB = v('--key-white-b', '#16302a');
    const black = v('--key-black', '#03080a');
    const font = v('--mono', 'ui-monospace, monospace');
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const ww = W / this.whiteCount;
    ctx.clearRect(0, 0, W, H);
    // white keys: rounded at the front, shaded where they go under the bed
    let wi = 0;
    for (let n = FIRST; n <= LAST; n++) {
      if (isBlack(n)) continue;
      const x = wi * ww + 1, kw = ww - 2;
      const g = this.glow.get(n) ?? 0;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, whiteA);
      grad.addColorStop(1, whiteB);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.roundRect(x, -6, kw, H + 6 - 1, [0, 0, 2, 2]); ctx.fill();
      if (g > 0) {
        // the colour blooms up from the front of the key
        const bloom = ctx.createLinearGradient(0, H, 0, 0);
        bloom.addColorStop(0, `rgba(${ph}, ${0.85 * g})`);
        bloom.addColorStop(0.55, `rgba(${ph}, ${0.25 * g})`);
        bloom.addColorStop(1, `rgba(${ph}, 0)`);
        ctx.fillStyle = bloom;
        ctx.shadowColor = `rgba(${ph}, 0.9)`; ctx.shadowBlur = 26 * g;
        ctx.beginPath(); ctx.roundRect(x, -6, kw, H + 6 - 1, [0, 0, 2, 2]); ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = `rgba(${ph}, ${0.14 + 0.5 * g})`;
      ctx.fillRect(x + 3, H - 4, kw - 6, 2);
      if (n % 12 === 0) {
        ctx.fillStyle = `rgba(${ph}, ${0.45 + 0.4 * g})`;
        ctx.font = `${Math.max(9, Math.min(11, ww * 0.45))}px ${font}`;
        ctx.textAlign = 'center';
        ctx.fillText(`C${n / 12 - 1}`, x + kw / 2, H - 12);
      }
      wi++;
    }
    // the shadow of the key bed over the back of the keys
    const bed = ctx.createLinearGradient(0, 0, 0, 14);
    bed.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    bed.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bed; ctx.fillRect(0, 0, W, 14);
    // black keys
    for (let n = FIRST; n <= LAST; n++) {
      if (!isBlack(n)) continue;
      const cx = this.whiteIndex[n] * ww;
      const bw = ww * 0.58, bh = H * 0.6;
      const g = this.glow.get(n) ?? 0;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';                     // its shadow on the white keys
      ctx.beginPath(); ctx.roundRect(cx - bw / 2 + 2, -4, bw, bh + 7, 1); ctx.fill();
      ctx.fillStyle = black;
      ctx.beginPath(); ctx.roundRect(cx - bw / 2, -4, bw, bh + 4, [0, 0, 1, 1]); ctx.fill();
      const cap = ctx.createLinearGradient(0, 0, 0, bh);
      cap.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
      cap.addColorStop(0.85, `rgba(${ph}, 0.1)`);
      cap.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
      ctx.fillStyle = cap;
      ctx.beginPath(); ctx.roundRect(cx - bw / 2 + 2, -4, bw - 4, bh - 2, 1); ctx.fill();
      if (g > 0) {
        ctx.shadowColor = `rgba(${mg}, 0.9)`; ctx.shadowBlur = 22 * g;
        const glow = ctx.createLinearGradient(0, bh, 0, 0);
        glow.addColorStop(0, `rgba(${mg}, ${0.95 * g})`);
        glow.addColorStop(1, `rgba(${mg}, ${0.2 * g})`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.roundRect(cx - bw / 2, -4, bw, bh + 4, [0, 0, 1, 1]); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    if (this.held) {
      ctx.fillStyle = `rgba(${mg},0.06)`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

/** Computer keyboard: two rows, like most DAWs. */
export class ComputerKeys {
  private map = new Map<string, number>();
  private active = new Map<string, number>();
  public octave = 4;

  constructor(private handler: KeyboardHandler, private onOctave?: (o: number) => void) {
    const lower = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'"];
    lower.forEach((k, i) => this.map.set(k, i));
    const upper = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'];
    const whites = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
    upper.forEach((k, i) => this.map.set(k, whites[i] - 12));
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const key = e.key.toLowerCase();
    if (down && !e.repeat) {
      if (key === 'arrowleft' || key === '-') { this.setOctave(this.octave - 1); e.preventDefault(); return; }
      if (key === 'arrowright' || key === '=') { this.setOctave(this.octave + 1); e.preventDefault(); return; }
    }
    const off = this.map.get(key);
    if (off === undefined) return;
    e.preventDefault();
    if (down) {
      if (e.repeat || this.active.has(key)) return;
      const note = (this.octave + 1) * 12 + off;
      if (note < FIRST || note > LAST) return;
      this.active.set(key, note);
      this.handler.noteOn(note, e.shiftKey ? 120 : 92);
    } else {
      const note = this.active.get(key);
      if (note === undefined) return;
      this.active.delete(key);
      this.handler.noteOff(note);
    }
  }

  private setOctave(o: number): void {
    this.releaseAll();
    this.octave = Math.max(1, Math.min(6, o));
    this.onOctave?.(this.octave);
  }

  private releaseAll(): void {
    for (const [, n] of this.active) this.handler.noteOff(n);
    this.active.clear();
  }
}
