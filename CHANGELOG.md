# Changelog

All notable changes to ft-vector. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## Unreleased

## [0.1.0] - 2026-11-15

First public release.

### Added
- VECTOR, a clean-digital synth that models digital systems themselves: clock dividers, 8-bit registers ticked at a frame clock, quantisers and a transmission link that loses data. Six chip channels (two pulses, wave, noise, 2-op FM, phase distortion) plus a seventh, band-limited (PolyBLEP) saw/square channel with 1-7 unison voices, detune and stereo spread.
- Register modulation (two 8-bit registers, a cellular automaton, chord arp, glide, XOR, table envelopes), the frame-counted note arp, the frame echo, an SVF, a gated plate reverb, an ensemble chorus, a stereo width control and a frame-clocked pump.
- The link: clock drift, jitter, a 512-sample MDCT codec, packet loss with four concealment modes, word length with dither, bit errors and a tiny-speaker stage.
- 170 factory presets in a searchable browser, including a "neon" category built on the saw channel, chorus, width and pump, plus saved user presets and a real power switch.
- The FT Instrument look: black-glass modules, per-module neon accents, full-width channel strips, and pictures drawn with the instrument's own maths.
- VST3 (macOS, Windows, Linux), AU (macOS) and standalone builds with JUCE 8, built by a GitHub Actions workflow and attached to each release. The C++ engine is a line-for-line port of the TypeScript one and renders every preset bit-identically.
- Bundled fonts (Orbitron, Chakra Petch, Geist, Geist Mono, a small symbols fallback; SIL OFL): the UI and the plugin make no network connections.
- AGPL-3.0 license, copyright and third-party notices.

[Unreleased]: https://github.com/ft-instruments/ft-vector/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ft-instruments/ft-vector/releases/tag/v0.1.0
