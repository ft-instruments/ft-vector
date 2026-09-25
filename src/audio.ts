// Main-thread handle on the AudioWorklet synth.

import workletUrl from './worklet/processor.ts?worker&url';
import type { WorkletMessage, WorkletStats, WorkletNote } from './worklet/processor.ts';
import type { ParamId, ParamValues } from './dsp/params.ts';

export class Synth {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  public onStats: ((s: WorkletStats) => void) | null = null;
  /** Notes started by the engine itself (arp). */
  public onNote: ((n: WorkletNote) => void) | null = null;

  get running(): boolean { return this.ctx?.state === 'running'; }

  async start(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.node = new AudioWorkletNode(this.ctx, 'ft-vector', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node.port.onmessage = (e: MessageEvent<WorkletStats | WorkletNote>) => {
        if (e.data?.type === 'stats') this.onStats?.(e.data);
        else if (e.data?.type === 'note') this.onNote?.(e.data);
      };
      this.node.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  get latencyMs(): number {
    if (!this.ctx) return 0;
    return (this.ctx.baseLatency + (this.ctx.outputLatency || 0)) * 1000;
  }

  private send(m: WorkletMessage): void { this.node?.port.postMessage(m); }

  noteOn(note: number, velocity: number): void { this.send({ type: 'noteOn', note, velocity }); }
  noteOff(note: number): void { this.send({ type: 'noteOff', note }); }
  cc(cc: number, value: number): void { this.send({ type: 'cc', cc, value }); }
  bend(value: number): void { this.send({ type: 'bend', value }); }
  setParam(id: ParamId, value: number): void { this.send({ type: 'param', id, value }); }
  setParams(values: Partial<ParamValues>): void { this.send({ type: 'params', values }); }
  loadPreset(values: Partial<ParamValues>): void { this.send({ type: 'preset', values }); }
  panic(): void { this.send({ type: 'panic' }); }
}
