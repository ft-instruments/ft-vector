// Web MIDI input. Listens to every input (or a chosen one) and forwards
// note / controller messages.

export interface MidiHandler {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  cc(cc: number, value: number): void;
  bend(value: number): void;   // -1..1
}

export interface MidiPort {
  id: string;
  name: string;
}

export class MidiInput {
  private access: MIDIAccess | null = null;
  private selected: string | 'all' = 'all';
  public onPortsChanged: ((ports: MidiPort[]) => void) | null = null;
  public onActivity: (() => void) | null = null;

  constructor(private handler: MidiHandler) {}

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async init(): Promise<boolean> {
    if (!MidiInput.supported) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return false;
    }
    this.access.onstatechange = () => this.attach();
    this.attach();
    return true;
  }

  get ports(): MidiPort[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id }));
  }

  select(id: string | 'all'): void {
    this.selected = id;
    this.attach();
  }

  private attach(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      const use = this.selected === 'all' || input.id === this.selected;
      input.onmidimessage = use ? (e) => this.onMessage(e) : null;
    }
    this.onPortsChanged?.(this.ports);
  }

  private onMessage(e: MIDIMessageEvent): void {
    const d = e.data;
    if (!d || d.length < 2) return;
    const status = d[0] & 0xf0;
    const a = d[1], b = d.length > 2 ? d[2] : 0;
    switch (status) {
      case 0x90:
        if (b > 0) this.handler.noteOn(a, b); else this.handler.noteOff(a);
        break;
      case 0x80:
        this.handler.noteOff(a);
        break;
      case 0xb0:
        this.handler.cc(a, b);
        break;
      case 0xe0:
        this.handler.bend(((b << 7) | a) / 8192 - 1);
        break;
      default:
        return;
    }
    this.onActivity?.();
  }
}
