// The link: the path from the synth to the listener as a digital
// transmission with real failure modes. C++ ports of src/dsp/link.ts and
// src/dsp/codec.ts. Everything is transparent at zero.
#pragma once

#include <vector>
#include "Util.h"

namespace ftvector {

// ---- link.ts -------------------------------------------------------------------

class Link {
public:
  /** true while a packet is being concealed (for the display) */
  bool losing = false;

  explicit Link(double sampleRate) : fs(sampleRate) {
    dbufL.assign(DLEN, 0.f); dbufR.assign(DLEN, 0.f);
    dRead = DLEN - 2048;
    const size_t maxPkt = (size_t)std::ceil(0.02 * sampleRate) + 8;
    lastL.assign(maxPkt, 0.f); lastR.assign(maxPkt, 0.f);
  }

  void clear() {
    std::fill(dbufL.begin(), dbufL.end(), 0.f); std::fill(dbufR.begin(), dbufR.end(), 0.f);
    std::fill(std::begin(jbufL), std::end(jbufL), 0.f); std::fill(std::begin(jbufR), std::end(jbufR), 0.f);
    std::fill(lastL.begin(), lastL.end(), 0.f); std::fill(lastR.begin(), lastR.end(), 0.f);
    errL = errR = 0; std::fill(std::begin(spk), std::end(spk), 0.f); smearL = smearR = 0;
  }

  /** The transmitter's clock: drift and jitter. */
  void clock(float* L, float* R, int n, double drift, double jitter) {
    if (drift > 0) driftStage(L, R, n, drift);
    if (jitter > 0) jitterStage(L, R, n, jitter);
  }

  /** The receiver: packet loss, word length, bit errors. */
  void receive(float* L, float* R, int n, double loss, double frameMs, int conceal, int bits, int dither, double ber) {
    if (loss > 0) packets(L, R, n, loss, frameMs, conceal); else losing = false;
    if (bits < 16) words(L, R, n, bits, dither);
    if (ber > 0) bitErrors(L, R, n, ber);
  }

  // ---- tiny speaker: mono, band-passed, a resonance around 1.4 kHz, a little overdrive
  void speaker(float* L, float* R, int n, double amount) {
    float* s = spk;
    const double hpA = 1 - std::exp(-2 * PI * 260 / fs);
    const double lpA = 1 - std::exp(-2 * PI * 3600 / fs);
    const double w = 2 * PI * 1400 / fs, r = 0.985;
    const double b0 = (1 - r) * 2, a1 = -2 * r * std::cos(w), a2 = r * r;
    for (int i = 0; i < n; i++) {
      const double x = ((double)L[i] + R[i]) * 0.5;
      s[0] = (float)(s[0] + (x - s[0]) * hpA); double y = x - s[0];
      s[1] = (float)(s[1] + (y - s[1]) * hpA); y -= s[1];
      s[2] = (float)(s[2] + (y - s[2]) * lpA); s[3] = (float)(s[3] + ((double)s[2] - s[3]) * lpA); y = s[3];
      const double bp = b0 * y - a1 * s[4] - a2 * s[5];
      s[5] = s[4]; s[4] = (float)bp;
      y = tanhf_((y + bp * 0.6) * 1.6) * 0.8;
      L[i] = (float)(L[i] + (y - L[i]) * amount);
      R[i] = (float)(R[i] + (y - R[i]) * amount);
    }
  }

private:
  static constexpr int DLEN = 8192;
  static constexpr double SQUELCH = 1.0 / 32768;   // one 16-bit LSB
  enum { CONCEAL_MUTE = 0, CONCEAL_REPEAT = 1, CONCEAL_SMEAR = 2, CONCEAL_CONTINUE = 3 };

  static bool quiet(double l, double r) { return l < SQUELCH && l > -SQUELCH && r < SQUELCH && r > -SQUELCH; }

  // ---- clock drift: read the buffer at a rate that wanders around 1
  void driftStage(float* L, float* R, int n, double amount) {
    float* bl = dbufL.data(); float* br = dbufR.data();
    const int len = DLEN;
    // a slow AR(1) walk, plus a restoring force so the read pointer never runs away
    wander += rng.bi() * 0.08 - wander * 0.02;
    if (wander > 1) wander = 1; else if (wander < -1) wander = -1;
    double gap = dWrite - dRead; if (gap < 0) gap += len;
    const double err = (gap - 2048) / 1024;
    const double target = 1 + amount * 0.012 * wander - err * 0.004 * amount;
    double read = dRead;
    for (int i = 0; i < n; i++) {
      bl[dWrite] = L[i]; br[dWrite] = R[i];
      dWrite = (dWrite + 1) % len;
      rate += (target - rate) * 0.001;
      const int i0 = (int)read; const double frac = read - i0; const int i1 = (i0 + 1) % len;
      L[i] = (float)(bl[i0] + ((double)bl[i1] - bl[i0]) * frac);
      R[i] = (float)(br[i0] + ((double)br[i1] - br[i0]) * frac);
      read += rate; if (read >= len) read -= len;
    }
    dRead = read;
  }

  // ---- clock jitter: low-passed noise modulates a fractional delay
  void jitterStage(float* L, float* R, int n, double amount) {
    const double depth = amount * amount * 28;
    const double a = 1 - std::exp(-2 * PI * 1500 / fs);
    int idx = jIdx; double nz = jNoise;
    for (int i = 0; i < n; i++) {
      jbufL[idx] = L[i]; jbufR[idx] = R[i];
      nz += (rng.bi() - nz) * a;
      const double d = 34 + nz * depth;
      L[i] = (float)readDelay(jbufL, 128, idx, d);
      R[i] = (float)readDelay(jbufR, 128, idx, d);
      idx = (idx + 1) & 127;
    }
    jIdx = idx; jNoise = nz;
  }

  // ---- packet loss with concealment
  void packets(float* L, float* R, int n, double loss, double frameMs, int conceal) {
    const int wanted = std::max(8, (int)jsRound(frameMs * 1e-3 * fs));
    if (wanted != pktLen) { pktLen = wanted; pktPos = 0; }
    const int len = pktLen;
    float* lL = lastL.data(); float* lR = lastR.data();
    for (int i = 0; i < n; i++) {
      if (pktPos == 0) {
        // a new packet: does it arrive?
        const bool was = lost;
        lost = rng.next() < loss * loss * 0.9 + loss * 0.1;
        lostRun = lost ? (was ? lostRun + 1 : 1) : 0;
        if (lost && !was && conceal == CONCEAL_CONTINUE) periodLen = findPeriod(lL, len);
        losing = lost;
      }
      const int pos = pktPos;
      if (!lost) {
        lL[pos] = L[i]; lR[pos] = R[i];
        // short fade back in after a hole
        if (lostFade > 0) { const double g = 1 - lostFade / 16.0; L[i] = (float)(L[i] * g); R[i] = (float)(R[i] * g); lostFade--; }
      } else {
        switch (conceal) {
          case CONCEAL_MUTE:
            L[i] = 0; R[i] = 0; lostFade = 16;
            break;
          case CONCEAL_REPEAT:
            L[i] = lL[pos]; R[i] = lR[pos];
            break;
          case CONCEAL_SMEAR: {
            // repeat the last packet through a darkening, fading one-pole
            const double k = std::pow(0.55, lostRun);
            smearL += (lL[pos] - smearL) * 0.25;
            smearR += (lR[pos] - smearR) * 0.25;
            L[i] = (float)(smearL * k); R[i] = (float)(smearR * k);
            break;
          }
          default: {
            // continue the last period of the last good packet, fading slowly
            const int pl = periodLen;
            const int j = len - pl + ((pos + (lostRun - 1) * len) % pl);
            const double k = std::pow(0.8, lostRun - 1);
            L[i] = (float)(lL[j] * k); R[i] = (float)(lR[j] * k);
          }
        }
      }
      if (++pktPos >= len) pktPos = 0;
    }
  }

  /** Length of the last period in a buffer, by rising zero crossings (falls back to the whole packet). */
  static int findPeriod(const float* buf, int len) {
    int last = -1;
    for (int i = len - 1; i > 0; i--) {
      if (buf[i - 1] < 0 && buf[i] >= 0) {
        if (last < 0) last = i;
        else if (last - i >= 16) return last - i;
      }
    }
    return len;
  }

  // ---- word length with dither
  void words(float* L, float* R, int n, int bits, int dither) {
    const double q = std::pow(2.0, bits - 1), iq = 1 / q;
    double eL = errL, eR = errR;
    for (int i = 0; i < n; i++) {
      double l = L[i], r = R[i];
      // squelch: a silent word stays silent (no dither hiss between notes)
      if (quiet(l, r)) { L[i] = 0; R[i] = 0; eL = eR = 0; continue; }
      if (dither == 1) {
        l += (rng.next() + rng.next() - 1) * iq;
        r += (rng.next() + rng.next() - 1) * iq;
      } else if (dither == 2) { l -= eL; r -= eR; }
      const double ql = jsRound(l * q) * iq, qr = jsRound(r * q) * iq;
      if (dither == 2) { eL = ql - l; eR = qr - r; }
      L[i] = (float)ql; R[i] = (float)qr;
    }
    errL = eL; errR = eR;
  }

  static float flip(double x, int bit) {
    int w = (int)jsRound(std::max(-1.0, std::min(1.0, x)) * 32767) & 0xffff;
    w ^= 1 << bit;
    return (float)((int16_t)(uint16_t)w / 32767.0);
  }

  // ---- bit errors in the 16-bit words
  void bitErrors(float* L, float* R, int n, double ber) {
    const double p = ber * ber * ber * 0.06;
    for (int i = 0; i < n; i++) {
      if (quiet(L[i], R[i])) continue;   // nothing on the line
      if (rng.next() < p) { const int bit = (int)(rng.next() * 16); L[i] = flip(L[i], bit); }
      if (rng.next() < p) { const int bit = (int)(rng.next() * 16); R[i] = flip(R[i], bit); }
    }
  }

  double fs;
  Rng rng { 0x5eed };
  // drift: a wandering read pointer
  std::vector<float> dbufL, dbufR;
  int dWrite = 0; double dRead = 0, wander = 0, rate = 1;
  // jitter: a short modulated delay
  float jbufL[128] = {}, jbufR[128] = {};
  int jIdx = 0; double jNoise = 0;
  // packet loss
  std::vector<float> lastL, lastR;
  int pktLen = 0, pktPos = 0; bool lost = false; int lostRun = 0;
  int lostFade = 0; double smearL = 0, smearR = 0;
  int periodLen = 0;
  // dither / noise shaping
  double errL = 0, errR = 0;
  // speaker
  float spk[16] = {};
};

// ---- codec.ts ------------------------------------------------------------------

/** A 512-sample MDCT coder: the largest coefficients that fit the bit budget survive, coarsely quantised. */
class Codec {
public:
  /** coefficients kept in the last block (display) */
  int kept = 0;

  explicit Codec(double sampleRate) : fs(sampleRate) {
    for (int n = 0; n < W; n++) win[n] = (float)std::sin(PI * (n + 0.5) / W);
    cosT.assign((size_t)N * W, 0.f);
    for (int k = 0; k < N; k++)
      for (int n = 0; n < W; n++)
        cosT[(size_t)(k * W + n)] = (float)std::cos((PI / N) * (n + 0.5 + N / 2) * (k + 0.5));
  }

  void clear() {
    std::fill(std::begin(inBuf), std::end(inBuf), 0.f); std::fill(std::begin(overlap), std::end(overlap), 0.f);
    std::fill(std::begin(outBuf), std::end(outBuf), 0.f);
    std::fill(std::begin(delayL), std::end(delayL), 0.f); std::fill(std::begin(delayR), std::end(delayR), 0.f);
    inPos = 0; outPos = N;
  }

  /** In place. `amount` 0..1 wet mix, `kbps` the bit budget. */
  void process(float* L, float* R, int n, double amount, double kbps) {
    if (amount <= 0) return;
    const double bits = kbps * 1000 * N / fs;                                            // bits per block
    const int keep = (int)std::max(2.0, std::min((double)N, jsRound(bits / 7)));       // ~7 bits per surviving coefficient
    const int cutoff = (int)std::min((double)N, jsRound(N * (0.12 + 0.88 * std::min(1.0, kbps / 160))));
    const int qSteps = (int)std::max(3.0, std::min(256.0, jsRound(4 + kbps * 2)));
    const double side = 1 - amount * (1 - std::min(1.0, kbps / 96));
    for (int i = 0; i < n; i++) {
      const double mid = ((double)L[i] + R[i]) * 0.5;
      // the dry path is delayed by the codec latency (2N) so the mix lines up
      const int dOut = dIdx;
      const double dryMid = ((double)delayL[dOut] + delayR[dOut]) * 0.5, drySide = ((double)delayL[dOut] - delayR[dOut]) * 0.5;
      delayL[dOut] = L[i]; delayR[dOut] = R[i];
      dIdx = (dOut + 1) % W;
      // feed the coder
      inBuf[inPos] = (float)mid;
      if (++inPos >= W) inPos = 0;
      if (outPos >= N) { block(keep, cutoff, qSteps); outPos = 0; }
      const double wet = outBuf[outPos++];
      const double m = dryMid + (wet - dryMid) * amount;
      const double s = drySide * side;
      L[i] = (float)(m + s); R[i] = (float)(m - s);
    }
  }

private:
  static constexpr int N = 256;   // coefficients per block; window is 2N
  static constexpr int W = 2 * N;

  /** Every N samples: transform the last 2N, quantise, inverse, overlap-add. */
  void block(int keep, int cutoff, int qSteps) {
    const float* ct = cosT.data();
    // gather the windowed frame in time order
    int p = inPos;
    for (int i = 0; i < W; i++) { synth[i] = (float)((double)inBuf[p] * win[i]); if (++p >= W) p = 0; }
    // forward
    double max = 0;
    for (int k = 0; k < N; k++) {
      double s = 0;
      const float* row = ct + k * W;
      for (int i = 0; i < W; i++) s += (double)synth[i] * row[i];
      coef[k] = (float)s;
      const double a = s < 0 ? -s : s;
      mags[k] = (float)(k < cutoff ? a : 0);
      if (a > max) max = a;
    }
    // bit allocation: keep the `keep` largest, quantise them relative to the block peak
    double thr = 0;
    if (keep < cutoff) {
      std::copy(std::begin(mags), std::end(mags), sorted);
      std::sort(sorted, sorted + N);
      thr = sorted[N - keep];
    }
    const double step = max > 0 ? max / qSteps : 1, inv = 1 / step;
    int kc = 0;
    // inverse (sparse: most coefficients are zero at low bitrates), window, overlap-add
    std::fill(std::begin(synth), std::end(synth), 0.f);
    for (int k = 0; k < N; k++) {
      const double a = mags[k];
      if (k >= cutoff || a < thr || a == 0) continue;
      const double c = jsRound(coef[k] * inv) * step;
      if (c == 0) continue;
      kc++;
      const float* row = ct + k * W;
      for (int i = 0; i < W; i++) synth[i] = (float)(synth[i] + c * row[i]);
    }
    kept = kc;
    const double scale = 2.0 / N;
    for (int i = 0; i < W; i++) synth[i] = (float)(synth[i] * (scale * win[i]));
    for (int i = 0; i < N; i++) { outBuf[i] = (float)((double)overlap[i] + synth[i]); overlap[i] = synth[N + i]; }
  }

  double fs;
  float win[W] = {};
  std::vector<float> cosT;   // N × W basis, precomputed
  float inBuf[W] = {};       // last 2N mid samples
  int inPos = 0;
  float coef[N] = {}, mags[N] = {}, sorted[N] = {};
  float synth[W] = {};       // current block's inverse transform
  float overlap[N] = {};     // tail of the previous block
  float outBuf[N] = {};      // decoded samples ready to be read
  int outPos = N;
  float delayL[W] = {}, delayR[W] = {};   // to align the dry / side path
  int dIdx = 0;
};

} // namespace ftvector
