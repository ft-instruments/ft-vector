// The filter and the time effects: Chamberlin SVF, the frame echo and the
// gated plate. C++ ports of src/dsp/svf.ts, echo.ts and reverb.ts.
// Buffers are allocated in the constructors, never while processing.
#pragma once

#include <vector>
#include "Util.h"

namespace ftvector {

// ---- svf.ts --------------------------------------------------------------------

/** Chamberlin state-variable filter, run twice per sample. */
class SVF {
public:
  explicit SVF(double sampleRate) : fs(sampleRate) {}

  void clear() { lp = bp = 0; }

  /** In place. mode 0 off, 1 lp, 2 bp, 3 hp. */
  void process(float* buf, int off, int n, int mode, double cutoff, double res) {
    if (mode == 0) return;
    double f = 2 * std::sin(PI * cutoff / (fs * 2));
    if (f > 0.99) f = 0.99;
    const double q = 1 - res * 0.985;
    double l = lp, b = bp, h = 0;
    for (int i = off; i < off + n; i++) {
      const double x = buf[i];
      for (int k = 0; k < 2; k++) {
        l += f * b;
        h = x - l - q * b;
        b += f * h;
      }
      // keep the state sane if driven hard
      if (b > 4) b = 4; else if (b < -4) b = -4;
      buf[i] = (float)(mode == 1 ? l : mode == 2 ? b : h);
    }
    lp = l; bp = b;
  }

private:
  double lp = 0, bp = 0;
  double fs;
};

// ---- echo.ts -------------------------------------------------------------------

/** A software echo counted in frames, 4-bit feedback steps, the echo path quantised to 4 bits. */
class Echo {
public:
  explicit Echo(double sampleRate) : len((int)std::ceil(sampleRate * 32 / 8) + 64) {
    bufL.assign((size_t)len, 0.f); bufR.assign((size_t)len, 0.f);
  }

  void clear() { std::fill(bufL.begin(), bufL.end(), 0.f); std::fill(bufR.begin(), bufR.end(), 0.f); }

  /** In place. `delay` in samples (0 = off), `fb` 0..0.94, `mix` 0..1. */
  void process(float* L, float* R, int n, double delay, double fb, bool ping, double mix) {
    if (delay <= 0 || mix <= 0) return;
    int d = (int)jsRound(delay); if (d >= len - 1) d = len - 1; if (d < 1) d = 1;
    float* bl = bufL.data(); float* br = bufR.data();
    int i0 = idx;
    const double q = 8, iq = 1 / q;   // 4-bit echo path
    for (int i = 0; i < n; i++) {
      int r = i0 - d; if (r < 0) r += len;
      // truncate, don't round: rounding lets a small value feed back to itself forever (a limit cycle)
      const double el = std::trunc(bl[r] * q) * iq, er = std::trunc(br[r] * q) * iq;
      if (ping) { bl[i0] = (float)(L[i] + er * fb); br[i0] = (float)(R[i] + el * fb); }
      else { bl[i0] = (float)(L[i] + el * fb); br[i0] = (float)(R[i] + er * fb); }
      L[i] = (float)(L[i] + el * mix); R[i] = (float)(R[i] + er * mix);
      if (++i0 >= len) i0 = 0;
    }
    idx = i0;
  }

private:
  std::vector<float> bufL, bufR;
  int idx = 0;
  int len;
};

// ---- reverb.ts -----------------------------------------------------------------

/** Plate: an 8-line Householder FDN, short and bright, with an optional gate on the tail. */
class Plate {
public:
  explicit Plate(double sampleRate) : fs(sampleRate) {
    const double ratio = sampleRate / 48000;
    for (int i = 0; i < N; i++) {
      lines[i].assign((size_t)std::ceil(BASE[i] * ratio * MAX_SCALE + MOD_DEPTH * 2 + 8), 0.f);
      modPhase[i] = (float)((double)i / N);
    }
    for (int i = 0; i < 4; i++) ap[i].assign((size_t)std::max(2.0, jsRound(AP_MS[i] * 1e-3 * sampleRate)), 0.f);
    pre.assign((size_t)jsRound(0.006 * sampleRate), 0.f);
    setSize(0.5, 1.2);
  }

  void clear() {
    for (auto& l : lines) std::fill(l.begin(), l.end(), 0.f);
    for (auto& a : ap) std::fill(a.begin(), a.end(), 0.f);
    std::fill(pre.begin(), pre.end(), 0.f);
    std::fill(std::begin(lp), std::end(lp), 0.f); std::fill(std::begin(hp), std::end(hp), 0.f);
    inEnv = gateEnv = 0;
  }

  /** In place. `size` 0..1, `decay` seconds, `tone` 0..1, `gate` 0..1 (0 = off, else 20–400 ms hold), `mix` 0..1. */
  void process(float* L, float* R, int n, double size, double decay, double tone, double gate, double mix) {
    if (mix <= 0) return;
    setSize(size, decay);
    const double lpA = 1 - std::exp(-2 * PI * (2500 + tone * 12000) / fs);
    const double hpA = 1 - std::exp(-2 * PI * 120 / fs);
    const double twoOverN = 2.0 / N;
    const double wet = mix * 0.7, dry = 1 - mix * 0.3;
    const int preLen = (int)pre.size();
    const bool gateOn = gate > 0;
    const double holdSamples = (0.02 + gate * 0.38) * fs;
    const double envA = 1 - std::exp(-2 * PI * 30 / fs);
    const double closeA = 1 - std::exp(-2 * PI * 200 / fs);
    double ie = inEnv, ge = gateEnv, gh = gateHold;
    for (int i = 0; i < n; i++) {
      const double xl = L[i], xr = R[i];
      const double inMono = (xl + xr) * 0.5;
      const double preOut = pre[(size_t)preIdx]; pre[(size_t)preIdx] = (float)inMono; if (++preIdx >= preLen) preIdx = 0;
      const double x = allpass(allpass(allpass(allpass(preOut, 0), 1), 2), 3);
      double sum = 0, outL = 0, outR = 0;
      for (int j = 0; j < N; j++) {
        double ph = modPhase[j] + MOD_RATE[j] / fs; if (ph >= 1) ph -= 1; modPhase[j] = (float)ph;
        const double d = lengths[j] + std::sin(6.283185307 * ph) * MOD_DEPTH;
        const double v = readDelay(lines[j].data(), (int)lines[j].size(), idx[j], d);
        tmp[j] = (float)v; sum += v;
        if (j & 1) outR += (j & 2) ? v : -v; else outL += (j & 2) ? v : -v;
      }
      const double s = sum * twoOverN;
      for (int j = 0; j < N; j++) {
        double v = (tmp[j] - s) * gains[j] + ((j & 1) ? -x : x);
        lp[j] = (float)(lp[j] + (v - lp[j]) * lpA);
        hp[j] = (float)(hp[j] + ((double)lp[j] - hp[j]) * hpA);
        v = (double)lp[j] - hp[j];
        auto& line = lines[j];
        line[(size_t)idx[j]] = (float)v;
        if (++idx[j] >= (int)line.size()) idx[j] = 0;
      }
      double g = 1;
      if (gateOn) {
        // open while the input is present, hold, then close fast
        const double a = inMono < 0 ? -inMono : inMono;
        ie += (a - ie) * envA;
        if (ie > 0.01) { gh = holdSamples; ge += (1 - ge) * closeA; }
        else if (gh > 0) { gh -= 1; ge += (1 - ge) * closeA; }
        else ge += (0 - ge) * closeA;
        g = ge;
      }
      L[i] = (float)(xl * dry + outL * wet * g);
      R[i] = (float)(xr * dry + outR * wet * g);
    }
    inEnv = ie; gateEnv = ge; gateHold = gh;
  }

private:
  static constexpr int N = 8;
  static constexpr double BASE[N] = { 449, 587, 701, 823, 937, 1063, 1187, 1301 };   // samples at 48 kHz
  static constexpr double MOD_RATE[N] = { 0.7, 1.1, 0.9, 1.3, 0.8, 1.2, 1.0, 0.6 };
  static constexpr double AP_MS[4] = { 1.1, 2.3, 3.7, 5.9 };
  static constexpr double AP_G = 0.7;
  static constexpr double MAX_SCALE = 1.5;
  static constexpr double MOD_DEPTH = 1.5;   // samples

  void setSize(double size, double decay) {
    if (size == curSize && decay == curDecay) return;
    curSize = size; curDecay = decay;
    const double scale = (0.5 + size) * fs / 48000;
    for (int i = 0; i < N; i++) {
      lengths[i] = BASE[i] * scale;
      gains[i] = (float)std::pow(10.0, (-3 * lengths[i]) / (decay * fs));
    }
  }

  double allpass(double x, int i) {
    auto& buf = ap[i];
    int k = apIdx[i];
    const double d = buf[(size_t)k];
    const double v = x - AP_G * d;
    buf[(size_t)k] = (float)v;
    if (++k >= (int)buf.size()) k = 0;
    apIdx[i] = k;
    return d + AP_G * v;
  }

  std::vector<float> lines[N];
  int idx[N] = {};
  double lengths[N] = {};
  float gains[N] = {}, lp[N] = {}, hp[N] = {}, modPhase[N] = {}, tmp[N] = {};
  std::vector<float> ap[4];
  int apIdx[4] = {};
  std::vector<float> pre;
  int preIdx = 0;
  double fs;
  double curSize = -1, curDecay = -1;
  double inEnv = 0, gateEnv = 0, gateHold = 0;
};

} // namespace ftvector
