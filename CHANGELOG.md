# Changelog

All notable changes to ft-vector. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## Unreleased

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
