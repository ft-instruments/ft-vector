// Sound-chip oscillators, modelled as mechanisms rather than waveforms.
// C++ port of src/dsp/chip.ts.
//
// Every source runs at an internal sample rate (8 kHz … 96 kHz) with naive
// generation, then goes through a zero-order hold / box-average resampler
// to the host rate. Pitch is what an integer clock divider can reach.
#pragma once

#include "Util.h"

namespace ftvector {

enum { SRC_PULSE = 0, SRC_WAVE = 1, SRC_NOISE = 2, SRC_FM = 3, SRC_PD = 4, SRC_SAW = 5 };

/** Most unison voices the saw channel can stack. */
constexpr int MAX_UNISON = 7;

/** Master clock of the divider, 2A03-style: f = CLOCK / (16 (N + 1)), 11-bit N. */
constexpr double DIVIDER_CLOCK = 1789773;
constexpr double TWO_PI = PI * 2;

/** The frequency the chip actually produces for a wanted one, blended towards exact by `precision`. */
inline double dividerTune(double f, double precision) {
  if (precision >= 1) return f;
  double n = jsRound(DIVIDER_CLOCK / (16 * f) - 1);
  if (n < 8) n = 8; else if (n > 2047) n = 2047;
  const double chip = DIVIDER_CLOCK / (16 * (n + 1));
  return chip + (f - chip) * precision;
}

struct OscParams {
  int type = SRC_PULSE;
  double ratio = 1;          // internal sample rate / host sample rate
  double inc = 0;            // cycles per internal sample
  double duty = 0.5;         // pulse
  const float* wave = nullptr;   // 32 cells, 0..15
  bool noiseShort = false;   // LFSR mode
  double noiseInc = 0;       // LFSR shifts per internal sample
  double fmRatio = 2;
  double fmIndex = 0;        // radians
  double fmFb = 0;
  int pdShape = 0;
  double pdAmt = 0;
};

/** Casio-style phase distortion: bend the phase, read a cosine. */
inline double pd(double ph, int shape, double amt) {
  switch (shape) {
    case 0: { // saw: the knee moves from 0.5 towards 0
      const double d = 0.5 - amt * 0.49;
      const double g = ph < d ? ph * (0.5 / d) : 0.5 + (ph - d) * (0.5 / (1 - d));
      return std::cos(TWO_PI * g);
    }
    case 1: { // square: fast transitions, flat tops
      const double k = 1 / (1 - amt * 0.97);
      const double g = ph < 0.5 ? std::min(0.5, ph * k) : 0.5 + std::min(0.5, (ph - 0.5) * k);
      return std::cos(TWO_PI * g);
    }
    case 2: { // pulse: one whole cosine cycle squeezed into the start
      const double k = 1 / (1 - amt * 0.95);
      return std::cos(TWO_PI * std::min(1.0, ph * k));
    }
    case 3: { // double sine: two cycles, the second squeezed
      const double d = 0.5 + amt * 0.45;
      const double g = ph < d ? ph / d : 1 + (ph - d) / (1 - d);
      return std::cos(TWO_PI * g);
    }
    case 4: // resonant saw: a sine at a multiple of the pitch, windowed by the falling saw
      return std::cos(TWO_PI * ph * (1 + amt * 15)) * (1 - ph);
    default: { // resonant triangle
      const double w = 1 - std::abs(2 * ph - 1);
      return std::cos(TWO_PI * ph * (1 + amt * 15)) * w;
    }
  }
}

class ChipOsc {
public:
  void reset(Rng& rng) {
    phase = rng.next();
    mPhase = 0; mPrev = 0;
    acc = 0; held = 0;
    if (lfsr == 0) lfsr = 1;
  }

  /** Adds n samples into `out` starting at `off`, scaled by `gain`. */
  void render(float* out, int off, int n, const OscParams& q, double gain) {
    const double ratio = q.ratio;
    double a = acc, h = held;
    for (int i = 0; i < n; i++) {
      a += ratio;
      if (a < 1) { out[off + i] = (float)(out[off + i] + h * gain); continue; }
      double sum = 0; int cnt = 0;
      while (a >= 1) { a -= 1; h = gen(q); sum += h; cnt++; }
      out[off + i] = (float)(out[off + i] + (sum / cnt) * gain);
    }
    acc = a; held = h;
  }

private:
  /** One internal-rate sample. */
  double gen(const OscParams& q) {
    double ph = phase + q.inc;
    if (ph >= 1) ph -= 1;
    phase = ph;
    switch (q.type) {
      case SRC_PULSE:
        return ph < q.duty ? 1 : -1;
      case SRC_WAVE:
        return (double)q.wave[(int)(ph * 32)] * (2.0 / 15) - 1;
      case SRC_NOISE: {
        // 15-bit LFSR clocked at its own rate, never faster than the internal clock
        double a = lfsrAcc + q.noiseInc;
        if (a >= 1) {
          a -= 1; if (a >= 1) a = 0.999;
          const uint32_t s = lfsr;
          const uint32_t fb = (s ^ (s >> (q.noiseShort ? 6 : 1))) & 1;
          lfsr = (s >> 1) | (fb << 14);
        }
        lfsrAcc = a;
        return (lfsr & 1) ? 1 : -1;
      }
      case SRC_FM: {
        double mp = mPhase + q.inc * q.fmRatio;
        if (mp >= 1) mp -= std::floor(mp);
        mPhase = mp;
        const double m = std::sin(TWO_PI * mp + q.fmFb * 2 * mPrev);
        mPrev = m;
        return std::sin(TWO_PI * ph + q.fmIndex * m);
      }
      default:
        return pd(ph, q.pdShape, q.pdAmt);
    }
  }

  double phase = 0, acc = 0, held = 0;
  uint32_t lfsr = 1;
  double lfsrAcc = 0, mPhase = 0, mPrev = 0;
};

/** PolyBLEP residual: smooths the step at a discontinuity, `dt` = phase increment per sample. */
inline double polyBlep(double t, double dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/**
 * One band-limited saw or square (PolyBLEP) at the host rate. Not on the
 * internal clock or the divider: the clean, modern oscillator the unison
 * saw channel stacks. C++ port of BlepOsc in src/dsp/chip.ts.
 */
class BlepOsc {
public:
  void reset(Rng& rng) { phase = rng.next(); }

  /** Adds n samples into `out` (from 0). `inc` is cycles per sample, below 0.5. */
  void render(float* out, int n, double inc, bool square) {
    double ph = phase;
    for (int i = 0; i < n; i++) {
      double y;
      if (square) {
        y = (ph < 0.5 ? 1 : -1) + polyBlep(ph, inc);
        double t = ph + 0.5; if (t >= 1) t -= 1;
        y -= polyBlep(t, inc);
      } else y = 2 * ph - 1 - polyBlep(ph, inc);
      out[i] = (float)(out[i] + y);
      ph += inc; if (ph >= 1) ph -= 1;
    }
    phase = ph;
  }

private:
  double phase = 0;
};

} // namespace ftvector
