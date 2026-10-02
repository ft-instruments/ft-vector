// Offline render of the C++ engine, the twin of `node scripts/render.ts raw`:
// the same phrase for every factory preset, written as raw float32 stereo
// (interleaved) to <dir>/<preset>.f32. scripts/null-test.ts compares the two.
//
//   render <dir>          every preset
//   render bench          CPU timing, like `render.ts bench`

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>
#include "../Source/dsp/Engine.h"

using namespace ftvector;

static constexpr double FS = 48000;
static constexpr int BLOCK = 128;

struct Ev { double t; std::function<void()> fn; };

static void render(Engine& e, double seconds, std::vector<Ev> events, std::vector<float>& L, std::vector<float>& R) {
  const int total = (int)std::ceil(seconds * FS / BLOCK) * BLOCK;
  L.assign(total, 0.f); R.assign(total, 0.f);
  std::stable_sort(events.begin(), events.end(), [](const Ev& a, const Ev& b) { return a.t < b.t; });
  size_t ev = 0;
  for (int off = 0; off < total; off += BLOCK) {
    const double t = off / FS;
    while (ev < events.size() && events[ev].t <= t) events[ev++].fn();
    e.process(L.data() + off, R.data() + off, BLOCK);
  }
}

static void phrase(Engine& e, double seconds, std::vector<float>& L, std::vector<float>& R) {
  std::vector<Ev> ev;
  auto play = [&](double t, int n, int v, double dur) {
    ev.push_back({ t, [&e, n, v] { e.noteOn(n, v); } });
    ev.push_back({ t + dur, [&e, n] { e.noteOff(n); } });
  };
  play(0.1, 48, 90, 3.2); play(0.1, 55, 85, 3.2); play(0.12, 60, 88, 3.2); play(0.14, 63, 84, 3.2); play(0.16, 67, 92, 3.2);
  play(3.6, 72, 100, 0.5); play(4.0, 70, 90, 0.5); play(4.4, 67, 95, 0.9); play(5.2, 63, 80, 1.2);
  render(e, seconds, ev, L, R);
}

static std::string slug(const char* name) {
  std::string s;
  bool space = false;
  for (const char* c = name; *c; c++) {
    if (*c == ' ' || *c == '\t') { space = true; continue; }
    if (space) { s += '-'; space = false; }
    s += (char)std::tolower((unsigned char)*c);
  }
  return s;
}

static const Preset* find(const char* name) {
  for (int i = 0; i < NUM_PRESETS; i++) if (std::string(PRESETS[i].name) == name) return &PRESETS[i];
  return nullptr;
}

int main(int argc, char** argv) {
  const std::string arg = argc > 1 ? argv[1] : "out/cpp";
  if (arg == "bench") {
    for (const char* name : { "Sleeper Pad", "Underwater", "Thomas" }) {
      const Preset* pr = find(name);
      if (!pr) continue;
      Engine e(FS);
      e.loadPreset(*pr);
      e.setParam(P::mode, 1);
      const int chord[] = { 48, 55, 60, 64, 67, 72, 76, 79 };
      for (int n : chord) e.noteOn(n, 100);
      std::vector<float> L(BLOCK), R(BLOCK);
      const int blocks = (int)(5 * FS / BLOCK);
      const auto t0 = std::chrono::steady_clock::now();
      for (int i = 0; i < blocks; i++) e.process(L.data(), R.data(), BLOCK);
      const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      std::printf("rendered 5 s with 8 voices of \"%s\" in %.0f ms  => %.1f%% of real time\n", name, ms, ms / 5000 * 100);
    }
    return 0;
  }
  for (int i = 0; i < NUM_PRESETS; i++) {
    Engine e(FS);
    e.loadPreset(PRESETS[i]);
    std::vector<float> L, R;
    phrase(e, 8, L, R);
    std::vector<float> inter(L.size() * 2);
    for (size_t k = 0; k < L.size(); k++) { inter[2 * k] = L[k]; inter[2 * k + 1] = R[k]; }
    const std::string path = arg + "/" + slug(PRESETS[i].name) + ".f32";
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) { std::fprintf(stderr, "cannot write %s\n", path.c_str()); return 1; }
    std::fwrite(inter.data(), sizeof(float), inter.size(), f);
    std::fclose(f);
  }
  std::printf("wrote %d presets to %s\n", NUM_PRESETS, arg.c_str());
  return 0;
}
