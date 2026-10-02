// The whole instrument: MIDI in, stereo audio out. C++ port of
// src/dsp/engine.ts. Construct with a sample rate (allocates), then feed
// noteOn / noteOff / controlChange / pitchBend and call process(L, R, n)
// with any n; nothing allocates after construction.
//
//   voices → SVF → clock (drift, jitter) → codec → receive (loss, words,
//   bit errors) → plate → speaker → volume → DC block → clip
//
// Two additions over the TS, for running inside a host: setHostTempo()
// replaces the tempo knob with the host's, and setHostPosition() locks the
// synced frame clock (24 ticks per beat) to the host's song position.
#pragma once

#include <memory>
#include <limits>
#include "Voice.h"
#include "Effects.h"
#include "Link.h"

namespace ftvector {

/** Told about notes the arp starts (for the UI). Called on the audio thread. */
struct NoteListener {
  virtual ~NoteListener() = default;
  virtual void engineNote(int note, double velocity) = 0;
};

inline ParamValues defaultParams() {
  ParamValues v{};
  for (int i = 0; i < NUM_PARAMS; i++) v[i] = PARAMS[i].def;
  return v;
}

class Engine {
public:
  static constexpr int MAX_VOICES = 8;
  static constexpr int CHUNK = 32;
  static constexpr double TICKS_PER_BEAT = 24;

  ParamValues p = defaultParams();
  Tables tables;
  NoteListener* listener = nullptr;
  double peakL = 0, peakR = 0;
  /** Recent output for the vector scope; ring buffers. */
  float scopeL[512] = {}, scopeR[512] = {};
  /** Live machine state for the display: r1, r2, ca lo, ca hi, vol pos, pitch pos, arp step, tick, losing, codec kept, voices. */
  uint8_t display[16] = {};

  explicit Engine(double sampleRate)
    : svfL(sampleRate), svfR(sampleRate), link(sampleRate), codec(sampleRate), plate(sampleRate), echo(sampleRate),
      dcL(sampleRate), dcR(sampleRate), arpOut(*this), fs(sampleRate) {
    for (int i = 0; i < MAX_VOICES; i++) voices[i] = std::make_unique<Voice>(sampleRate, (uint32_t)(i + 1), tables);
    for (int i = 0; i < NUM_PARAMS; i++) syncTable(i, p[i]);
  }

  int activeVoices() const {
    int c = 0;
    for (auto& v : voices) if (v->active()) c++;
    return c;
  }

  bool chip() const { return p[P::mode] < 0.5; }
  bool arpOn() const { return p[P::arpMode] >= 1; }

  // ---------------------------------------------------------------- params

  void setParam(int id, double value) {
    if (id < 0 || id >= NUM_PARAMS) return;
    const ParamDef& def = PARAMS[id];
    const double v = std::min(def.max, std::max(def.min, value));
    if (id == P::arpMode && v < 1 && p[P::arpMode] >= 1) arp.stop(arpOut);
    if (id == P::mode && v != p[P::mode]) allNotesOff();
    p[id] = v;
    if (def.tab >= 0) syncTable(id, v);
  }

  /** Replace every parameter (preset load). Missing ids go to their default. */
  void loadPreset(const Preset& pr) {
    ParamValues v = defaultParams();
    for (int i = 0; i < pr.count; i++) v[pr.values[i].id] = pr.values[i].value;
    for (int i = 0; i < NUM_PARAMS; i++) setParam(i, v[i]);
  }

  // ------------------------------------------------------------- host sync

  /** The host's tempo, or <= 0 to use the tempo knob. */
  void setHostTempo(double bpm) { hostTempo = bpm; }

  /** While the host plays, a synced frame clock ticks on its grid (position in quarter notes). */
  void setHostPosition(bool playing, double ppq) { hostPlaying = playing; hostPpq = ppq; }

  // ------------------------------------------------------------------ MIDI

  void noteOn(int note, double velocity) {
    if (velocity <= 0) { noteOff(note); return; }
    const double vel = std::min(1.0, velocity / 127);
    if (arpOn()) arp.keyDown(note, vel, p[P::arpHold] >= 0.5 || sustain);
    else voiceOn(note, vel);
  }

  void noteOff(int note) {
    if (arpOn()) arp.keyUp(note, p[P::arpHold] >= 0.5 || sustain);
    else voiceOff(note);
  }

  void controlChange(int cc, int value) {
    switch (cc) {
      case 64: {
        const bool on = value >= 64;
        if (on == sustain) break;
        sustain = on;
        if (!on) {
          for (auto& v : voices) {
            if (v->sustained && v->active() && !v->released) v->noteOff();
            v->sustained = false;
          }
          if (arpOn() && p[P::arpHold] < 0.5) arp.unlatch(arpOut);
        }
        break;
      }
      case 120: case 123: allNotesOff(); break;
      default: break;
    }
  }

  /** -1..1 */
  void pitchBend(double v) { bendNorm = std::max(-1.0, std::min(1.0, v)); }

  void allNotesOff() {
    arp.stop(arpOut);
    for (auto& v : voices) {
      if (v->active() && !v->released) v->noteOff();
      v->sustained = false;
    }
    held.clear();
  }

  void panic() {
    allNotesOff();
    for (auto& v : voices) v->kill();
    svfL.clear(); svfR.clear();
    link.clear(); codec.clear(); plate.clear(); echo.clear();
  }

  // ---------------------------------------------------------------- audio

  void process(float* L, float* R, int n) {
    if (hostTempo > 0) p[P::tempo] = hostTempo;
    std::fill(L, L + n, 0.f); std::fill(R, R + n, 0.f);
    const bool synced = p[P::frameSync] >= 0.5;
    const double frameHz = synced ? (p[P::tempo] / 60) * TICKS_PER_BEAT : p[P::frameHz];
    const double framePeriod = fs / frameHz;
    if (synced && hostPlaying) {
      // on the host's grid: the next tick is at the next 1/24 of a beat
      const double t = hostPpq * TICKS_PER_BEAT;
      frameAcc = (1 - (t - std::floor(t))) * framePeriod;
    }
    mod.bend = bendNorm * p[P::bend];
    for (int off = 0; off < n; off += CHUNK) {
      const int count = std::min(CHUNK, n - off);
      frameAcc -= count;
      while (frameAcc <= 0) { tick(); frameAcc += framePeriod; }
      for (auto& v : voices) if (v->active()) v->render(L, R, off, count, p, mod, tables);
      if (p[P::fMode] >= 1) {
        double cut = p[P::cutoff] * cutMul;
        if (cut < 20) cut = 20; else if (cut > 20000) cut = 20000;
        svfL.process(L, off, count, toInt(p[P::fMode]), cut, p[P::res]);
        svfR.process(R, off, count, toInt(p[P::fMode]), cut, p[P::res]);
      }
    }
    const double trim = 0.4;
    for (int i = 0; i < n; i++) { L[i] = (float)(L[i] * trim); R[i] = (float)(R[i] * trim); }
    echo.process(L, R, n, toInt(p[P::echoFrames]) * framePeriod, toInt(p[P::echoFb]) / 16.0, p[P::echoPing] >= 0.5, p[P::echoMix]);
    // the link
    link.clock(L, R, n, p[P::lkDrift], p[P::lkJitter]);
    codec.process(L, R, n, p[P::lkCodec], p[P::lkKbps]);
    link.receive(L, R, n, p[P::lkLoss], p[P::lkFrame], toInt(p[P::lkConceal]), toInt(p[P::lkBits]), toInt(p[P::lkDither]), p[P::lkBer]);
    plate.process(L, R, n, p[P::rvSize], p[P::rvDecay], p[P::rvTone], p[P::rvGate], p[P::rvMix]);
    if (p[P::lkSpeaker] > 0) link.speaker(L, R, n, p[P::lkSpeaker]);
    // volume, DC, safety clip, meters, scope
    const double vol = p[P::volume] * p[P::volume] * 1.6;
    double pl = 0, pr = 0;
    int si = scopeIdx;
    for (int i = 0; i < n; i++) {
      const double l = softClip(dcL.tick(L[i] * vol));
      const double r = softClip(dcR.tick(R[i] * vol));
      L[i] = (float)l; R[i] = (float)r;
      const double al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      scopeL[si] = (float)l; scopeR[si] = (float)r; si = (si + 1) & 511;
    }
    scopeIdx = si;
    peakL = pl; peakR = pr;
    display[8] = link.losing ? 1 : 0;
    display[9] = (uint8_t)std::min(255, codec.kept);
    display[10] = (uint8_t)activeVoices();
  }

private:
  /** What the arp plays into: straight to the voices. */
  struct ArpOut : NoteSink {
    Engine& e;
    explicit ArpOut(Engine& engine) : e(engine) {}
    void noteOn(int note, double velocity) override {
      e.voiceOn(note, velocity);
      if (e.listener) e.listener->engineNote(note, velocity);
    }
    void noteOff(int note) override { e.voiceOff(note); }
  };

  void syncTable(int id, double v) {
    const ParamDef& def = PARAMS[id];
    float* t = def.tab == 0 ? tables.wave : def.tab == 1 ? tables.tvA : def.tab == 2 ? tables.tvB : def.tab == 3 ? tables.tp : nullptr;
    if (t) t[def.idx] = (float)v;
  }

  // --------------------------------------------------------- allocation

  int heldIndex(int note) const {
    for (int i = 0; i < held.size; i++) if (held[i] == note) return i;
    return -1;
  }

  void voiceOn(int note, double vel) {
    if (chip()) {
      // one voice; more keys = the chip arp cycles them at frame rate
      Voice& v = *voices[0];
      const int idx = heldIndex(note);
      if (idx >= 0) held.removeAt(idx);
      held.push(note);
      cycleIdx = held.size - 1;
      if (!v.active() || v.released || held.size == 1) v.noteOn(note, vel, p, true);
      else v.setNote(note, p[P::glide]);
      v.sustained = false;
    } else {
      Voice& v = allocate(note);
      v.noteOn(note, vel, p, true, lastNote);
      v.sustained = false;
    }
    lastNote = note;
  }

  void voiceOff(int note) {
    if (chip()) {
      const int idx = heldIndex(note);
      if (idx >= 0) held.removeAt(idx);
      Voice& v = *voices[0];
      if (!v.active() || v.released) return;
      if (held.size > 0) {
        if (v.note == note) { cycleIdx = held.size - 1; v.setNote(held[cycleIdx], p[P::glide]); }
      } else if (sustain) v.sustained = true;
      else v.noteOff();
    } else {
      for (auto& v : voices) {
        if (v->note != note || !v->active() || v->released) continue;
        if (sustain) v->sustained = true; else v->noteOff();
      }
    }
  }

  Voice& allocate(int note) {
    for (auto& v : voices) if (v->active() && v->note == note && !v->released) return *v;
    for (auto& v : voices) if (!v->active()) return *v;
    // steal: quietest released voice, else the oldest
    Voice* best = nullptr; double bestScore = std::numeric_limits<double>::infinity();
    for (auto& vp : voices) {
      Voice& v = *vp;
      const double score = v.released ? v.level() : 10 - v.age * 1e-6;
      if (score < bestScore) { bestScore = score; best = &v; }
    }
    return best ? *best : *voices[0];
  }

  // ------------------------------------------------------------ the frame

  void tick() {
    tickCount++;
    r1.tick(toInt(p[P::r1Op]), toInt(p[P::r1Step]), toInt(p[P::r1Mask]), toInt(p[P::r1Div]));
    r2.tick(toInt(p[P::r2Op]), toInt(p[P::r2Step]), toInt(p[P::r2Mask]), toInt(p[P::r2Div]));
    ca.tick(toInt(p[P::caRule]), toInt(p[P::caDiv]));
    arp.tick(toInt(p[P::arpMode]), toInt(p[P::arpDiv]), toInt(p[P::arpOct]), p[P::arpGate], arpOut);
    const int loopA = toInt(p[P::tvALoop]), loopB = toInt(p[P::tvBLoop]);
    for (auto& v : voices) if (v->active()) v->tick(p, loopA, loopB);
    if (chip()) {
      // the chip arp: cycle the held keys, one per frame
      Voice& v = *voices[0];
      if (held.size > 1 && v.active() && !v.released) {
        cycleIdx = (cycleIdx + 1) % held.size;
        v.setNote(held[cycleIdx], p[P::glide]);
      }
    } else if (p[P::cycle] > 0) {
      // modern: the same cycling survives as a round-robin accent between the voices
      int n = 0;
      for (auto& v : voices) if (v->active()) n++;
      if (n > 1) {
        const int pick = (int)(tickCount % (uint32_t)n);
        int i = 0;
        for (auto& v : voices) {
          if (!v->active()) continue;
          v->accent = i == pick ? 1 : 1 - p[P::cycle] * 0.5;
          i++;
        }
      } else for (auto& v : voices) v->accent = 1;
    }
    // modulation for the next frame
    const double o1 = r1.out(toInt(p[P::r1Mask])), o2 = r2.out(toInt(p[P::r2Mask]));
    const double caV = ca.value(), caB = caV * 2 - 1;
    mod.pitchCt = o1 * p[P::r1Pitch] + o2 * p[P::r2Pitch];
    mod.caSemi = jsRound((ca.count8() / 8.0) * p[P::caPitch]);
    mod.duty = o1 * p[P::r1Duty] + o2 * p[P::r2Duty] + caB * p[P::caDuty];
    mod.level = (1 - p[P::r1Level] * (0.5 - o1 * 0.5)) * (1 - p[P::r2Level] * (0.5 - o2 * 0.5)) * (1 - p[P::caLevel] * (1 - caV));
    cutMul = std::pow(2.0, (o1 * p[P::r1Cut] + o2 * p[P::r2Cut] + caB * p[P::caCut]) * 3);
    // display
    display[0] = (uint8_t)r1.value; display[1] = (uint8_t)r2.value;
    display[2] = (uint8_t)(ca.cells & 255); display[3] = (uint8_t)((ca.cells >> 8) & 255);
    display[4] = (uint8_t)voices[0]->volPos.pos; display[5] = (uint8_t)voices[0]->pitPos.pos;
    display[6] = (uint8_t)(arp.position() & 255); display[7] = (uint8_t)(tickCount & 255);
  }

  std::unique_ptr<Voice> voices[MAX_VOICES];
  Register r1, r2;
  Automaton ca;
  Arp arp;
  SVF svfL, svfR;
  Link link;
  Codec codec;
  Plate plate;
  Echo echo;
  DCBlock dcL, dcR;
  Mod mod;
  double cutMul = 1;
  double bendNorm = 0;
  bool sustain = false;
  FixedList<int, 128> held;   // chip mode: keys down, in order
  int cycleIdx = 0;
  double lastNote = std::numeric_limits<double>::quiet_NaN();
  double frameAcc = 0;
  uint32_t tickCount = 0;
  int scopeIdx = 0;
  double hostTempo = 0, hostPpq = 0;
  bool hostPlaying = false;
  ArpOut arpOut;
  double fs;
};

} // namespace ftvector
