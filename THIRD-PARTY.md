# Third-party software

VECTOR is licensed under the [AGPL v3](LICENSE). What it includes or builds on:

| Component | Used for | License |
|---|---|---|
| [JUCE](https://juce.com) 8 | the plugin shell (VST3, AU, standalone, WebView), fetched by CMake at build time, not copied into this repo | AGPLv3 (or commercial; this project uses the AGPL option) |
| VST3 SDK (3.7.x) | bundled inside JUCE | Steinberg VST3 License or GPLv3 (this project uses the GPLv3 option, which is compatible with the AGPLv3) |
| [Orbitron](https://github.com/theleagueof/orbitron) | logo font, `src/fonts/` (Latin subset) | SIL OFL 1.1, [`src/fonts/OFL-orbitron.txt`](src/fonts/OFL-orbitron.txt) |
| [Chakra Petch](https://github.com/m4rc1e/Chakra-Petch) | display font, `src/fonts/` (Latin subset, weights 500, 600, 700) | SIL OFL 1.1, [`src/fonts/OFL-chakra-petch.txt`](src/fonts/OFL-chakra-petch.txt) |
| [Geist](https://github.com/vercel/geist-font) | UI font, `src/fonts/` (Latin subset) | SIL OFL 1.1, [`src/fonts/OFL-geist.txt`](src/fonts/OFL-geist.txt) |
| [Geist Mono](https://github.com/vercel/geist-font) | monospace font, `src/fonts/` (Latin subset) | SIL OFL 1.1, [`src/fonts/OFL-geist-mono.txt`](src/fonts/OFL-geist-mono.txt) |
| [Noto Sans Symbols](https://github.com/notofonts/symbols) 1 and 2 | arrows and key/geometric symbols, subset into `src/fonts/ft-symbols.woff2` | SIL OFL 1.1, [`src/fonts/OFL-noto-symbols.txt`](src/fonts/OFL-noto-symbols.txt) |

Build-time only (nothing of it ships): Vite, TypeScript and `@types/node`, plus
their dependencies, all MIT, ISC, BSD or Apache-2.0.

There are no samples or impulse responses: the sound is synthesized.
"Steinberg" and "VST" are trademarks of Steinberg Media Technologies GmbH;
"Audio Units" is a trademark of Apple Inc.
