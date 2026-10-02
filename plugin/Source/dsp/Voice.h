// One voice: the six chip channels playing one note. C++ port of
// src/dsp/voice.ts. Levels, pitches and duties are computed once per
// 32-sample chunk (and ramped over it), the way a chip driven by a frame
// interrupt behaves anyway.
#pragma once

#include <limits>
#include "Chip.h"
#include "Machine.h"

namespace ftvector {

/** What the engine computes per frame for every voice. */
struct Mod {
  double pitchCt = 0;   // registers → pitch, cents
  double caSemi = 0;    // automaton → pitch, semitones (integer)
  double duty = 0;      // -1..1 offset applied to pulse width
  double level = 1;     // 0..1 multiplier
  double bend = 0;      // semitones
};

/** The drawn tables, shared by every voice (Float32Arrays in the TS). */
struct Tables {
  float wave[32] = {};
  float tvA[16] = {};
  float tvB[16] = {};
  float tp[16] = {};
};

class Voice {
public:
  int note = 60;
  double vel = 1;
  bool released = false;
  double age = 0;
  double accent = 1;
  /** Held by the sustain pedal (the TS keeps these in a Set). */
  bool sustained = false;
  /** current pitch when gliding (fractional MIDI note); equals `note` otherwise */
  double pitch = 60;
  /** chord arp: which interval of the chord is sounding */
  int chordSemi = 0;
  TablePos volPos, pitPos;

  Voice(double sampleRate, uint32_t seed, const Tables& tables)
    : ch { Channel(sampleRate, SRC_PULSE, tables.wave), Channel(sampleRate, SRC_PULSE, tables.wave),
           Channel(sampleRate, SRC_WAVE, tables.wave), Channel(sampleRate, SRC_NOISE, tables.wave),
           Channel(sampleRate, SRC_FM, tables.wave), Channel(sampleRate, SRC_PD, tables.wave) },
      rng(seed * 7919 + 17), fs(sampleRate) {}

  bool active() const {
    for (auto& c : ch) if (c.env.active()) return true;
    return false;
  }

  /** The loudest channel envelope, for voice stealing. */
  double level() const {
    double m = 0;
    for (auto& c : ch) if (c.env.value > m) m = c.env.value;
    return m;
  }

  void noteOn(int n, double v, const ParamValues& p, bool retrigger,
              double glideFrom = std::numeric_limits<double>::quiet_NaN()) {
    // with glide, a new note slides from wherever the last one was
    if (p[P::glide] <= 0) pitch = n;
    else if (!active()) pitch = std::isnan(glideFrom) ? n : glideFrom;
    note = n; vel = v; released = false; age = 0;
    if (!retrigger) return;
    volPos.reset(); pitPos.reset();
    chordStep = 0; chordDir = 1; chordCount = 0; chordSemi = 0;
    for (int i = 0; i < 6; i++) {
      Channel& c = ch[i];
      if (p[CHANNEL_IDS[i].level] <= 0) { c.env.kill(); continue; }
      c.osc.reset(rng);
      c.env.gate();
    }
  }

  /** Chip arp: change pitch without retriggering (glides there if glide is on). */
  void setNote(int n, double glide) { note = n; if (glide <= 0) pitch = n; }

  void noteOff() {
    released = true;
    for (auto& c : ch) c.env.release();
  }

  void kill() {
    for (auto& c : ch) { c.env.kill(); c.gain = 0; }
    released = true;
  }

  /** Frame tick: advance the table envelopes, the chord arp and the glide. */
  void tick(const ParamValues& p, int volLoopA, int volLoopB) {
    // stepped portamento: so many semitones per frame towards the note
    const double glide = p[P::glide];
    if (glide > 0 && pitch != note) {
      const double d = note - pitch;
      if (std::abs(d) <= glide) pitch = note; else pitch += d > 0 ? glide : -glide;
    } else pitch = note;
    // the 8-bit chord: one interval per `chordSpeed` frames from a single key
    const int chord = toInt(p[P::chord]);
    if (chord > 0) {
      const int* semis = CHORD_SEMIS[chord];
      const int slen = CHORD_LEN[chord];
      const int len = p[P::chordOct] >= 0.5 ? slen * 2 : slen;
      if (++chordCount >= toInt(p[P::chordSpeed])) {
        chordCount = 0;
        const int dir = toInt(p[P::chordDir]);
        if (dir == 0) chordStep = (chordStep + 1) % len;
        else if (dir == 1) chordStep = (chordStep + len - 1) % len;
        else if (len > 1) {
          chordStep += chordDir;
          if (chordStep >= len) { chordStep = len - 2; chordDir = -1; } else if (chordStep < 0) { chordStep = 1; chordDir = 1; }
        }
      }
      const int i = chordStep;
      chordSemi = semis[i % slen] + (i >= slen ? 12 : 0);
    } else chordSemi = 0;
    const int div = toInt(p[P::tabDiv]);
    // one position drives both volume tables: table A's loop unless only B is in use
    bool usesA = false, usesB = false;
    for (int i = 0; i < 6; i++) { const int e = toInt(p[CHANNEL_IDS[i].env]); if (e == 1) usesA = true; else if (e == 2) usesB = true; }
    volPos.tick(div, usesA || !usesB ? volLoopA : volLoopB);
    pitPos.tick(div, toInt(p[P::tpLoop]));
  }

  void render(float* L, float* R, int off, int n, const ParamValues& p, const Mod& mod, const Tables& tabs) {
    age += n;
    const double clockHz = CLOCK_HZ[toInt(p[P::clock])];
    const double ratio = clockHz / fs;
    const double velGain = 1 - p[P::vel] + p[P::vel] * vel;
    const double basePitch = pitch + chordSemi + mod.bend + mod.pitchCt * 0.01 + mod.caSemi;
    for (int i = 0; i < 6; i++) {
      Channel& c = ch[i];
      const ChannelIds& id = CHANNEL_IDS[i];
      OscParams& q = c.q;
      const double lvl = p[id.level];
      if (!c.env.active()) { c.gain = 0; continue; }
      // envelope: ADSR, or a drawn table gated by a fast ADSR whose release is the channel's
      const int envMode = toInt(p[id.env]);
      double env;
      if (envMode == 0) env = c.env.run(n, p[id.atk], p[id.dec], p[id.sus], p[id.rel]);
      else env = c.env.run(n, 0.001, 0.005, 1, p[id.rel]) * (double)(envMode == 1 ? tabs.tvA : tabs.tvB)[volPos.pos] / 15;
      // pitch
      double pt = basePitch + p[id.oct] * 12 + p[id.semi] + p[id.fine] * 0.01;
      if (p[id.ptab] >= 0.5) pt += tabs.tp[pitPos.pos];
      double f = dividerTune(midiToFreq(pt), p[P::precision]);
      if (f > clockHz * 0.5) f = clockHz * 0.5;
      q.ratio = ratio;
      q.inc = f / clockHz;
      switch (q.type) {
        case SRC_PULSE: {
          const int d = toInt(p[i == 0 ? P::p1Duty : P::p2Duty]);
          const double duty = (d < 4 ? DUTY_VALUES[d] : p[i == 0 ? P::p1Width : P::p2Width]) + mod.duty * 0.45;
          q.duty = duty < 0.02 ? 0.02 : duty > 0.98 ? 0.98 : duty;
          break;
        }
        case SRC_NOISE: {
          q.noiseShort = p[P::nzMode] < 0.5;
          // the LFSR is clocked at 93× the pitch so short mode plays the note; long mode is hiss
          const double r = midiToFreq(pt) * 93 / clockHz;
          q.noiseInc = r > 1 ? 1 : r;
          break;
        }
        case SRC_FM:
          q.fmRatio = p[P::fmRatio];
          q.fmIndex = p[P::fmIndex] * 8 * (1 - p[P::fmEnvAmt] + p[P::fmEnvAmt] * env);
          q.fmFb = p[P::fmFb];
          break;
        case SRC_PD:
          q.pdShape = toInt(p[P::pdShape]);
          q.pdAmt = p[P::pdAmt] * (1 - p[P::pdEnvAmt] + p[P::pdEnvAmt] * env);
          break;
        default: break;
      }
      // render, then pan and ramp the gain over the chunk
      const double gain = lvl * velGain * env * mod.level * accent;
      std::fill(tmp, tmp + n, 0.f);
      c.osc.render(tmp, 0, n, q, 1);
      if (i == 0) std::copy(tmp, tmp + n, p1);
      else if (i == 1 && p[P::p2Xor] >= 0.5) for (int k = 0; k < n; k++) tmp[k] = (float)((double)tmp[k] * p1[k]);
      const double pan = p[id.pan];
      const double gl = std::cos((pan + 1) * 0.25 * PI) * 1.2, gr = std::sin((pan + 1) * 0.25 * PI) * 1.2;
      double g = c.gain;
      const double dg = (gain - g) / n;
      for (int k = 0; k < n; k++) {
        g += dg;
        const double s = tmp[k] * g;
        L[off + k] = (float)(L[off + k] + s * gl);
        R[off + k] = (float)(R[off + k] + s * gr);
      }
      c.gain = gain;
    }
  }

private:
  struct Channel {
    ChipOsc osc;
    ADSR env;
    double gain = 0;   // last chunk's gain, for ramping
    OscParams q;
    Channel(double sampleRate, int type, const float* wave) : env(sampleRate) { q.type = type; q.wave = wave; }
  };

  Channel ch[6];
  int chordStep = 0, chordDir = 1, chordCount = 0;
  float tmp[64] = {};
  float p1[64] = {};   // pulse 1's last chunk, for the xor
  Rng rng;
  double fs;
};

} // namespace ftvector
