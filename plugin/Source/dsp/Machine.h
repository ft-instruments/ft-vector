// The frame-clocked machinery: 8-bit registers, the cellular automaton,
// table positions, the stepped ADSR, and the arp counted in frames.
// C++ ports of src/dsp/registers.ts and src/dsp/arp.ts.
//
// The TS arp uses growable arrays; here they are fixed-capacity arrays
// with the same insertion order and a stable sort, so both engines play
// the same notes and nothing allocates on the audio thread.
#pragma once

#include "Util.h"

namespace ftvector {

// ---- registers.ts ------------------------------------------------------------

/** An 8-bit register updated every `div` ticks by one of five operations. */
class Register {
public:
  int value = 0;   // 0..255

  void reset(int op, int step) {
    lastOp = op;
    count = 0; dir = 1;
    value = op == 2 || op == 4 ? ((step & 255) ? (step & 255) : 1) : 0;   // rotate / lfsr need a non-zero pattern
  }

  void tick(int op, int step, int mask, int div) {
    if (op != lastOp) reset(op, step);
    if (++count < div) return;
    count = 0;
    int v = value;
    switch (op) {
      case 0: // tri: bounce between 0 and 255
        v += dir * step;
        if (v >= 255) { v = 255; dir = -1; } else if (v <= 0) { v = 0; dir = 1; }
        break;
      case 1: // count: wrap
        v = (v + step) & 255;
        break;
      case 2: // rotate the bit pattern (the pattern is `step`)
        v = ((v << 1) | (v >> 7)) & 255;
        break;
      case 3: // add, then xor with the mask
        v = ((v + step) ^ mask) & 255;
        break;
      default: { // 8-bit Galois LFSR
        const int lsb = v & 1;
        v >>= 1;
        if (lsb) v ^= 0xb8;
        if (v == 0) v = (step & 255) ? (step & 255) : 1;
      }
    }
    value = v;
  }

  /** Masked value as -1..1. */
  double out(int mask) const { return ((value & mask) / 255.0) * 2 - 1; }

private:
  int dir = 1, count = 0, lastOp = -1;
};

/** 1-D elementary cellular automaton on 16 cells with wrap-around; one generation every `div` ticks. */
class Automaton {
public:
  int cells = 0x0100;

  void reset() { cells = 0x0100; count = 0; }

  void tick(int rule, int div) {
    if (rule != lastRule) { lastRule = rule; reset(); }
    if (++count < div) return;
    count = 0;
    const int c = cells;
    int next = 0;
    for (int i = 0; i < 16; i++) {
      const int l = (c >> ((i + 1) & 15)) & 1, m = (c >> i) & 1, r = (c >> ((i + 15) & 15)) & 1;
      const int idx = (l << 2) | (m << 1) | r;
      if ((rule >> idx) & 1) next |= 1 << i;
    }
    // a dead universe is restarted so the knob always does something
    cells = next == 0 ? 0x0100 : next;
  }

  /** Low byte as 0..1. */
  double value() const { return (cells & 255) / 255.0; }

  /** Live cells in the low byte, 0..8. */
  int count8() const {
    int c = cells & 255, n = 0;
    while (c) { n += c & 1; c >>= 1; }
    return n;
  }

private:
  int count = 0, lastRule = -1;
};

/** Tracker-style table position: one step every `div` ticks, looping from `loop` (16 = hold the last step). */
class TablePos {
public:
  int pos = 0;
  void reset() { pos = 0; count = 0; }
  void tick(int div, int loop) {
    if (++count < div) return;
    count = 0;
    if (pos < 15) pos++;
    else if (loop < 16) pos = loop;
  }
private:
  int count = 0;
};

/** Digital ADSR: linear attack, exponential decay / release. Retriggers from the current level. */
class ADSR {
public:
  double value = 0;
  int stage = 0;   // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release

  explicit ADSR(double sampleRate) : fs(sampleRate) {}

  bool active() const { return stage != 0; }
  void gate() { stage = 1; }
  void release() { if (stage != 0) stage = 4; }
  void kill() { stage = 0; value = 0; }

  /** Advance n samples and return the level at the end of the block (stepped per block, as on a chip). */
  double run(int n, double atk, double dec, double sus, double rel) {
    double v = value;
    switch (stage) {
      case 1:
        v += n / (atk * fs);
        if (v >= 1) { v = 1; stage = 2; }
        break;
      case 2: {
        const double k = std::exp(-n / (dec * fs * 0.25));
        v = sus + (v - sus) * k;
        if (v - sus < 0.001) { v = sus; stage = 3; }
        break;
      }
      case 3:
        v = sus;
        break;
      case 4: {
        const double k = std::exp(-n / (rel * fs * 0.25));
        v *= k;
        if (v < 0.0005) { v = 0; stage = 0; }
        break;
      }
      default:
        v = 0;
    }
    value = v;
    return v;
  }

private:
  double fs;
};

// ---- arp.ts ------------------------------------------------------------------

struct NoteSink {
  virtual ~NoteSink() = default;
  virtual void noteOn(int note, double velocity) = 0;
  virtual void noteOff(int note) = 0;
};

/** Arpeggiator counted in frames of the frame clock: one step every `div` ticks. */
class Arp {
public:
  /** current step for the display */
  int position() const { return step; }

  void keyDown(int note, double vel, bool hold) {
    if (hold && latched && keys.size == 0) { held.clear(); latched = false; }
    removeKey(note);
    keys.push({ note, vel });
    held = keys;
  }

  void keyUp(int note, bool hold) {
    removeKey(note);
    if (hold) { latched = true; return; }
    held = keys;
  }

  /** Called when hold is switched off / sustain released. */
  void unlatch(NoteSink& out) {
    latched = false;
    held = keys;
    if (held.size == 0) stop(out);
  }

  void stop(NoteSink& out) {
    if (sounding >= 0) { out.noteOff(sounding); sounding = -1; }
    keys.clear(); held.clear(); latched = false;
    frame = 0; step = 0; dir = 1;
  }

  /** One frame tick. */
  void tick(int mode, int div, int octaves, double gate, NoteSink& out) {
    if (mode == 0) return;
    if (gateLeft > 0 && --gateLeft == 0 && sounding >= 0) { out.noteOff(sounding); sounding = -1; }
    if (frame > 0) { frame--; return; }
    frame = div - 1;
    if (held.size == 0) { if (sounding >= 0) { out.noteOff(sounding); sounding = -1; } return; }
    // build the pattern: sorted (or as played) × octaves
    base = held;
    if (mode != 5) std::stable_sort(base.items, base.items + base.size, [](const Key& a, const Key& b) { return a.note < b.note; });
    const int len = base.size * octaves;
    int idx;
    switch (mode) {
      case 1: idx = step % len; step = (step + 1) % len; break;
      case 2: idx = len - 1 - (step % len); step = (step + 1) % len; break;
      case 3: {
        if (len <= 1) { idx = 0; break; }
        idx = step;
        step += dir;
        if (step >= len) { step = len - 2; dir = -1; } else if (step < 0) { step = 1; dir = 1; }
        idx = std::max(0, std::min(len - 1, idx));
        break;
      }
      case 4: idx = (int)(rng.next() * len); step = idx; break;
      default: idx = step % len; step = (step + 1) % len; break;
    }
    const Key& k = base[idx % base.size];
    const int note = k.note + 12 * (idx / base.size);
    if (sounding >= 0) out.noteOff(sounding);
    if (note <= 127) { out.noteOn(note, k.vel); sounding = note; }
    gateLeft = std::max(1, (int)jsRound(gate * div));
    if (gateLeft >= div) gateLeft = 0;   // full gate: legato into the next step
  }

private:
  struct Key { int note; double vel; };

  void removeKey(int note) {
    int w = 0;
    for (int i = 0; i < keys.size; i++) if (keys[i].note != note) keys[w++] = keys[i];
    keys.size = w;
  }

  FixedList<Key, 128> keys, held, base;
  bool latched = false;
  int frame = 0, step = 0, dir = 1, sounding = -1, gateLeft = 0;
  Rng rng { 4242 };
};

} // namespace ftvector
