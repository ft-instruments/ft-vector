// The machine's displays: register bit rows, the scrolling automaton,
// the XY vector scope, and drawable grids for the tables. All draw in
// their window's accent colour (the --accent-rgb CSS variable).

function phosphor(el: HTMLElement): string {
  return getComputedStyle(el).getPropertyValue('--accent-rgb').trim() || '25,230,255';
}

function setupCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): { W: number; H: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = { width: canvas.clientWidth, height: canvas.clientHeight };   // layout size: the plugin scales the page
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W: r.width, H: r.height };
}

/** Eight LEDs showing a byte, MSB first, plus its value. */
export class BitRow {
  el: HTMLElement;
  private leds: HTMLElement[] = [];
  private val: HTMLElement;
  private last = -1;
  constructor(label: string) {
    const el = document.createElement('div');
    el.className = 'bitrow';
    const l = document.createElement('span'); l.className = 'label'; l.textContent = label;
    el.append(l);
    for (let i = 0; i < 8; i++) { const d = document.createElement('i'); el.append(d); this.leds.push(d); }
    const v = document.createElement('span'); v.className = 'val'; el.append(v);
    this.el = el; this.val = v;
    this.set(0);
  }
  set(byte: number): void {
    if (byte === this.last) return;
    this.last = byte;
    for (let i = 0; i < 8; i++) this.leds[i].classList.toggle('on', ((byte >> (7 - i)) & 1) === 1);
    this.val.textContent = byte.toString(16).padStart(2, '0').toUpperCase();
  }
}

/** The cellular automaton scrolling down like a tracker: 16 cells wide, newest generation at the bottom. */
export class AutomatonView {
  private ctx: CanvasRenderingContext2D;
  private rows: number[] = [];
  private lastCells = -1;
  constructor(private canvas: HTMLCanvasElement, private depth = 24) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  push(cells: number): void {
    if (cells === this.lastCells) return;
    this.lastCells = cells;
    this.rows.push(cells);
    if (this.rows.length > this.depth) this.rows.shift();
    this.draw();
  }
  draw(): void {
    const { W, H } = setupCanvas(this.canvas, this.ctx);
    const ctx = this.ctx, ph = phosphor(this.canvas);
    ctx.clearRect(0, 0, W, H);
    const cw = W / 16, ch = H / this.depth;
    const n = this.rows.length;
    for (let r = 0; r < n; r++) {
      const cells = this.rows[r];
      const age = (n - 1 - r) / this.depth;
      ctx.fillStyle = `rgba(${ph}, ${0.95 - age * 0.8})`;
      const y = H - (n - r) * ch;
      for (let c = 0; c < 16; c++) if ((cells >> c) & 1) ctx.fillRect(c * cw + 1, y + 1, cw - 2, ch - 2);
    }
  }
}

/** XY vector display: left on x, right on y, with phosphor persistence. */
export class VectorScope {
  private ctx: CanvasRenderingContext2D;
  private data: Float32Array = new Float32Array(1024);
  private peak = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  update(data: Float32Array, peak: number): void { this.data = data; this.peak = peak; this.draw(); }
  draw(): void {
    const { W, H } = setupCanvas(this.canvas, this.ctx);
    const ctx = this.ctx, ph = phosphor(this.canvas);
    // persistence: fade the previous frame instead of clearing
    ctx.fillStyle = 'rgba(2,3,10,0.35)';
    ctx.fillRect(0, 0, W, H);
    const d = this.data, n = 512;
    const cx = W / 2, cy = H / 2, s = Math.min(W, H) * 0.46;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(${ph}, ${0.5 + this.peak * 0.5})`;
    ctx.shadowColor = `rgba(${ph},0.9)`; ctx.shadowBlur = 6 + this.peak * 10;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      // rotate 45° so mono lands on a vertical line, like a real XY scope in stereo mode
      const l = d[i], r = d[512 + i];
      const x = cx + (l - r) * s * 0.7071, y = cy - (l + r) * s * 0.7071;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // graticule
    ctx.strokeStyle = `rgba(${ph},0.18)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, 2); ctx.lineTo(cx, H - 2); ctx.moveTo(2, cy); ctx.lineTo(W - 2, cy); ctx.stroke();
    ctx.fillStyle = this.peak > 0.95 ? 'rgba(255,80,80,0.9)' : `rgba(${ph},0.6)`;
    ctx.fillRect(0, H - 2, W * Math.min(1, this.peak), 2);
  }
}

/**
 * A drawable grid: `cols` columns of integer cells between `min` and `max`.
 * Click / drag paints; the value under the pointer's y is written to the
 * column under its x. A playhead column can be lit from the engine.
 */
export class TableGrid {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private values: number[];
  private playhead = -1;
  private loop = -1;
  private painting = false;

  constructor(label: string, private cols: number, private min: number, private max: number, initial: number[],
    private onChange: (idx: number, value: number) => void, cls = '') {
    this.values = initial.slice();
    const el = document.createElement('div');
    el.className = `grid ${cls}`;
    const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
    const canvas = document.createElement('canvas');
    el.append(l, canvas);
    this.el = el; this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => { this.painting = true; canvas.setPointerCapture(e.pointerId); this.paint(e); e.preventDefault(); });
    canvas.addEventListener('pointermove', (e) => { if (this.painting) this.paint(e); });
    const end = () => { this.painting = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private paint(e: PointerEvent): void {
    // offsetX / offsetY are in layout pixels, so divide by the layout size (the plugin scales the page)
    const r = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(e.offsetX / r.width * this.cols)));
    const rows = this.max - this.min + 1;
    let v = this.max - Math.floor(e.offsetY / r.height * rows);
    if (e.buttons & 2) v = this.min < 0 ? 0 : this.min;    // right button clears
    v = Math.max(this.min, Math.min(this.max, v));
    if (this.values[col] === v) return;
    this.values[col] = v;
    this.onChange(col, v);
    this.draw();
  }

  set(idx: number, value: number): void { this.values[idx] = value; this.draw(); }
  setAll(values: number[]): void { this.values = values.slice(); this.draw(); }
  setPlayhead(col: number): void { if (col !== this.playhead) { this.playhead = col; this.draw(); } }
  setLoop(col: number): void { if (col !== this.loop) { this.loop = col; this.draw(); } }

  draw(): void {
    const { W, H } = setupCanvas(this.canvas, this.ctx);
    const ctx = this.ctx, ph = phosphor(this.canvas);
    ctx.clearRect(0, 0, W, H);
    const rows = this.max - this.min + 1;
    const cw = W / this.cols, ch = H / rows;
    // faint cell grid
    ctx.fillStyle = `rgba(${ph},0.07)`;
    for (let c = 0; c < this.cols; c++) for (let r = 0; r < rows; r++) ctx.fillRect(c * cw + 0.5, r * ch + 0.5, cw - 1, ch - 1);
    // zero line for bipolar tables
    if (this.min < 0) {
      const y = (this.max - 0 + 1) * ch;
      ctx.fillStyle = `rgba(${ph},0.3)`; ctx.fillRect(0, y - 0.5, W, 1);
    }
    for (let c = 0; c < this.cols; c++) {
      const v = this.values[c];
      const lit = c === this.playhead;
      ctx.fillStyle = `rgba(${ph}, ${lit ? 1 : 0.75})`;
      if (this.min < 0) {
        // bar from zero
        const y0 = (this.max + 1) * ch, y1 = (this.max - v + (v > 0 ? 1 : 0)) * ch;
        if (v !== 0) ctx.fillRect(c * cw + 1, Math.min(y0, y1), cw - 2, Math.abs(y1 - y0));
        else ctx.fillRect(c * cw + 1, y0 - 1, cw - 2, 2);
      } else {
        // filled column up to the value (a 0 is a single dark row)
        const y = (this.max - v) * ch;
        ctx.fillRect(c * cw + 1, y + 1, cw - 2, H - y - 1);
        if (v === 0) { ctx.fillStyle = `rgba(${ph},0.25)`; ctx.fillRect(c * cw + 1, H - ch + 1, cw - 2, ch - 2); }
      }
      if (lit) { ctx.fillStyle = `rgba(${ph},0.15)`; ctx.fillRect(c * cw, 0, cw, H); }
    }
    if (this.loop >= 0 && this.loop < this.cols) {
      ctx.fillStyle = `rgba(${ph},0.9)`;
      ctx.fillRect(this.loop * cw, 0, 1.5, H);
    }
  }
}
