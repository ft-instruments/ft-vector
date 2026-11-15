# Changelog

All notable changes to ft-vector. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## Unreleased

### Added
- Saw channel: a seventh, band-limited (PolyBLEP) saw/square source with 1–7 unison voices, detune and stereo spread. It runs at the host rate, outside the chip clock and divider. Off by default, so existing presets sound the same. Its parameters are appended after the existing ones.
- Ensemble chorus (mix, rate, depth) and a stereo width control (0 to 200%), both off at their defaults.
- Pump: a sidechain-style duck triggered by the frame clock every N frames, with a depth and a release. Off by default.
- "neon" preset category (12 presets) built on the saw channel, chorus, width and pump.
- Eight dark, sparse presets across the existing categories: Dial Tone, Shipwatching, Density, Cold Boot, Static Sleep, Relay, Hull Hum, Last Packet.

### Changed
- Interface density and legibility pass. The seven channels are now full-width strips (picture, then level, source and envelope on one row), about half the height of the old stacked panels, and a folded channel is a single line. Hero knobs sit beside the other controls instead of on a row of their own, the arp, filter, echo, plate, chorus and pump modules fit on fewer rows, and the chord choice is a dropdown. Text is larger and brighter (labels and readouts were 9.5–10px at about 40% contrast), and the words drawn inside the pictures sit on a dark plate.
- Filter cutoff and resonance now ramp across each 32-sample chunk instead of stepping, so cutoff sweeps no longer zipper.
- `CHUNK` is a shared constant, and the voice scratch buffers are sized from it.

## [0.1.0] - 2026-11-01

First tracked release. The version file already said 0.1.0, so this tags the project as it stands today, with the open-source and cross-platform work below.

### Added
- A clean-digital synth that models digital systems themselves (clock dividers, 8-bit registers, frame ticks).
- FT Instrument look, saved presets and a real power switch; the shared UI is unified with Mycelia and Siege.
- Compact preset browser and a second bank of 66 presets.
- AU / VST plugin build under `plugin/`.
- The header width stays steady as the DSP readout changes digits.
- AGPL-3.0 license, a Download section in the README and a GitHub Actions workflow that builds the plugin for macOS, Windows and Linux.

### Changed
- Fonts (Orbitron, Chakra Petch, Geist, Geist Mono; SIL OFL) are bundled in `src/fonts/` instead of loaded from Google Fonts: the UI and the plugin make no network connections.
- `plugin/CMakeLists.txt`: `VECTOR_INSTALL` option (off in CI) and `NEEDS_WEBVIEW2` for Windows.
- Linux: the editor's WebView renders on the GPU (`plugin/patch-juce.cmake` flips JUCE's WebKit acceleration policy; the editor forces shared-memory frames so it also works on NVIDIA). JUCE 8.0.9 to 8.0.15.

### Fixed
- Linux: arrows, `⌘` and `▪` showed as tofu because the bundled Latin fonts do not cover them; a small `FT Symbols` fallback (subset of Noto Sans Symbols 1/2, SIL OFL) now ships with the UI.
- Linux: the editor showed `Â·`, `â€“`, `â†’` instead of `·`, `–`, `→` (the WebView misread the text encoding); the plugin now serves its pages as UTF-8 explicitly and the built UI is pure ASCII (non-ASCII characters are escaped), so no encoding guess can break it.

[Unreleased]: https://github.com/filipefthomaz-gd/ft-vector/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/filipefthomaz-gd/ft-vector/releases/tag/v0.1.0
