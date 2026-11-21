# ft-vector

**VECTOR** — a clean-digital synth with its own physics. Instead of
modelling circuits and hiding that it is digital, Vector models **digital
systems themselves**: clock dividers, 8-bit registers ticked at a frame
clock, quantisers, and a transmission link that loses data. Chip squares,
glassy FM and phase-distortion, a band-limited unison saw, codec smear,
packet stutter. 170 factory presets. It runs in the browser, and the same DSP
core is built as a VST3 / AU plugin and a standalone app.

```
npm install
npm run dev        # open the printed URL in Chrome/Edge (Web MIDI)
npm run build      # static site in dist/
npm run render     # offline render of every preset to out/*.wav, no browser needed
npm run check      # headless Chrome: boots the worklet, plays a chord, screenshots
```

Play with a MIDI keyboard (notes, velocity, pitch bend, sustain CC64), the
on-screen keys (lower on the key = louder), or the computer keyboard
(`A`…`'` / `Z`…`/`, arrows change octave, Space = sustain). Drag knobs
vertically, `Shift` for fine, double-click to reset. Draw in the grids
(right button clears). **mutate** nudges the patch; **dump** puts the patch
JSON on the clipboard (paste it into `PRESETS` in `params.ts` to keep it).

## Download

Builds of the VST3, the AU (macOS only) and the standalone app for macOS,
Windows and Linux are attached to each
[release](https://github.com/ft-instruments/ft-vector/releases).

| | Standalone | VST3 | AU |
|---|---|---|---|
| macOS (Apple silicon + Intel) | yes | yes | yes |
| Windows | yes | yes | no |
| Linux | yes | yes | no |

Unzip and copy the plugin to your plugin folder (macOS
`~/Library/Audio/Plug-Ins/{VST3,Components}`, Windows
`C:\Program Files\Common Files\VST3`, Linux `~/.vst3`). The builds are not
signed or notarized: on macOS right-click the app and choose Open the first
time (or run `xattr -dr com.apple.quarantine` on the files); on Windows
SmartScreen asks once. The Windows editor needs the WebView2 runtime
(included in Windows 11); on Linux it needs WebKitGTK.

## Privacy

VECTOR makes no network connections: no telemetry, no update check, no
analytics, no accounts. The fonts are bundled ([`src/fonts/`](src/fonts/)),
the plugin serves its UI from memory (`PluginEditor.cpp`, a JUCE resource
provider), and JUCE is built without its networking code
(`JUCE_USE_CURL=0`). Your saved presets are plain files on your disk. To
check it yourself, search the source for `fetch(`, `XMLHttpRequest`,
`WebSocket` and `http` (the only hits are the SVG namespace string), or watch
the app with Little Snitch or `nettop`.

## Signal path

```
pulse 1 ─┐
pulse 2 ─┤  six chip channels, each: source → ADSR or table env → pan
wave    ─┤  (chip mode: one voice, held keys cycle at frame rate;
noise   ─┤   modern mode: 8 voices, the cycle becomes an accent)
fm      ─┤
pd      ─┘
saw ───────  a seventh, band-limited channel at the host rate (1–7 unison voices)
   → chorus → echo (frames) → SVF → LINK: drift · jitter → codec → packet loss → word length · bit errors
   → plate → pump → width → speaker → out
```

Everything lives in [`src/dsp/`](src/dsp/) and has no browser dependencies.

### 1. Sound-chip oscillators — `chip.ts`

Mechanisms, not waveforms. Every source is generated naively at a
selectable **internal rate** (8 kHz … 96 kHz) and then zero-order-held /
box-averaged to the host rate: the low rates fold the highs back down the
way real chips do (`render spectrum` measures it), 96 kHz is clean. Pitch
is what an integer **clock divider** can reach (2A03-style, 11-bit
period), so notes are slightly and systematically off — ±2 cents in the
middle, −18 cents at C8 (`render tuning`); **precision** blends to exact.

| channel | mechanism |
|---|---|
| pulse 1, 2 | four duty cycles (12.5 / 25 / 50 / 75 %) or a free width; duty is a modulation target |
| wave | 32 × 4-bit drawable table; the default is the NES triangle |
| noise | 15-bit LFSR, short (93-step, metallic, pitched) or long mode, clocked at 93× the note |
| fm | 2-operator FM with feedback; index follows the envelope by an amount |
| pd | Casio-style phase distortion: saw, square, pulse, double sine, resonant saw / tri; amount follows the envelope |
| saw | the one channel that is not a chip: a PolyBLEP band-limited saw or square, 1–7 unison voices with detune and stereo spread, run at the host rate outside the clock and divider. Off by default |

### 2. Register modulation — `registers.ts`

No LFOs. A **frame clock** (8–240 Hz, or 24 ticks per beat when synced)
ticks a small virtual machine, and everything it drives is audibly
stepped:

- **R1, R2** — 8-bit registers. Each tick (every `div` ticks) they
  **tri** (bounce), **count** (wrap), **rotate** their bit pattern
  (`step` is the pattern), add-then-**xor** with a mask, or run an
  8-bit **LFSR**. The masked value drives pitch (cents), pulse duty,
  level and filter cutoff. A rotating `00011111` on duty is the chip
  "phaser"; an xor-masked counter on pitch never quite repeats.
- **CA** — a 1-D cellular automaton, 16 cells, one generation every `div`
  ticks, any rule 0–255 (30 / 90 / 110 are the famous ones). Its live-cell
  count steps the pitch in semitones; its low byte drives duty, level,
  cutoff. Scrolls down the screen like a tracker.
- **Chord** — the *Thomas Was Alone* arp: one key, a chord shape (oct,
  5th, maj, min, sus4, 7ths, dim, aug, two octaves) cycled one interval
  per N frames, up / down / up-down, optionally over an extra octave.
  Famitracker's `0xy`, per voice, in both modes.
- **Chip arp** — in chip mode held keys are also cycled one per frame,
  the 8-bit way to polyphony. In modern mode the same cycle becomes a
  round-robin accent (`cycle`).
- **Glide** — tracker portamento: so many semitones *per frame* towards
  the new note, so slides are audibly stepped. Works on the key cycling
  too, so a held chord slides between its notes.
- **XOR** — pulse 2 can be multiplied by pulse 1 (for ±1 squares that is
  an XOR): the SID ring-mod, bells and hollow fifths from two squares.
- **Echo** — a software echo counted in frames, feedback in 4-bit steps,
  the echo path quantised to 4 bits so the tail decays in steps.
- **Table envelopes** — two 16 × 4-bit volume tables and a 16-step pitch
  table (±12 st), drawn, stepped every `frames/step` ticks, looping from a
  point or holding the last step. Any channel picks ADSR / tab A / tab B.
- **Arp** — counted in frames: up / down / up-down / random / as played,
  1–4 octaves, gate, latch (keeps the pattern running after the keys are released — off in every preset).

### 3. The link — `link.ts`, `codec.ts`

The path to the listener as a digital transmission. Every effect is a
real failure mode with a physical parameter; all at zero → transparent.

| stage | model |
|---|---|
| drift | the DAC clock wanders: a variable-rate resampler with a slow bounded random walk (±1.2 % at full) |
| jitter | timing noise on the sample clock: low-passed noise phase-modulates a fractional delay — shimmer when small, ghost sidebands when large |
| codec | a 512-sample MDCT coder: the largest coefficients that fit a bit budget (8–128 kbps) survive, quantised against the block peak, the rest are zeroed; the side signal thins out at low rates. Birdies, pre-echo, band-limit |
| packets | 1–20 ms frames lost at a rate, concealed by **mute** (holes), **repeat** (stutter), **smear** (darkening repeat), or **continue** (the last period looped, like a real PLC) |
| words | 4–16 bit with no / TPDF / first-order noise-shaped dither |
| bit errors | random flips in the 16-bit words: low bits hiss, high bits crackle |
| speaker | the tiny speaker: band-pass, a resonance at 1.4 kHz, mono, a little overdrive |

### The rest

| file | what |
|---|---|
| `svf.ts` | Chamberlin state-variable filter (lp / bp / hp), run twice per sample. Global, modulated by the registers. |
| `reverb.ts` | **Plate**: an 8-line FDN with short bright lines, light modulation, and a **gate** that holds the tail for 20–400 ms after the input stops, then cuts. |
| `chorus.ts` | Ensemble chorus: three slowly modulated delay taps per side, left and right offset in phase. Mix, rate, depth. A stereo **width** control (0–200 %) sits after the plate. |
| `pump.ts` | A sidechain-style duck whose "kick" is the frame clock: every N frames the level snaps down and recovers, so a held pad breathes with the machine. |
| `voice.ts` | One voice = the seven channels playing one note. Levels, pitches and duties are computed once per 32-sample chunk and ramped; envelopes step per chunk. |
| `arp.ts` | The frame-counted note arp (up / down / up-down / random / as played, 1–4 octaves, gate, hold). |
| `echo.ts` | The frame echo. |
| `engine.ts` | Voice allocation (chip: one voice with key cycling; modern: 8 voices, quiet-first stealing), sustain, bend, the frame tick, the effect chain, DC block, safety clip. `process(L, R, n)` is the whole instrument. |
| `params.ts` | The flat parameter list (what a host would see — the table cells are parameters too) and the factory presets. |

`scripts/render.ts` drives the engine in Node: `all`, `preset "Thomas"`,
`note 60 100`, `bench`, `spectrum 84` (harmonics and worst alias per
internal rate), `tuning` (divider error per note), `codec` (transparency
per bitrate). `scripts/check-browser.ts` runs the built site in headless
Chrome, starts the worklet, plays a chord and checks the output level.

## Presets

170, grouped in a searchable browser (click the preset name or press `` ` ``, `Esc` closes); `< >` step through them in browser order, **mutate** nudges.

| category | presets |
|---|---|
| chip | Thomas (major chord arp at 60 Hz, tri bass, LFSR hat, stepped vibrato, frame echo) · Chord Stab · Slide Bass (stepped glide, xor fifth) · Ring Lead · Metal Hat · Square Bass · Duty Phaser · Tracker Lead (pitch table) · Game Boy · Mega Lead · Octave Bass · Pixel Pluck · Boss Fight · Bubble · Laser · Arcade Orchestra |
| arps | Crystal Run · Stairway · Cascade Bells · Neon Stepper · Rain Arp · Broken Arp · Choir Arp (note arp + chord arp) · Prism Arp · Glass Cascade · Starlight Arp · Triplet Prism · Random Rain · Played Pulse · Chord Shimmer |
| tracker leads | Tracker Arp (the pitch table plays the chord) · Round Lead · Warm Square · Tracker Bell · Sweep Lead · Minor Third Lead · Octave Bounce · Hyper Saw · Vox Lead |
| bass | Sub Reactor · Reese Circuit · FM Punch Bass · Velvet Sub · PD Growl · Pluck Bass Array · Octave Runner · FM Rubber |
| drums & perc | Kick 8-bit · Snare Noise · Glitch Kit · Tom Divider · Deep Kick · Punch Kick · Snare Body · Clap Static · Closed Hat · Open Hat · Metal Ride · Chip Cowbell · Tom Cascade · House Machine · Glitch Perc — pitch tables, volume tables and the LFSR, the way chips did drums |
| pads | Sleeper Pad · Neon Choir · Hologram · Cold Storage · Server Room · Nebula Stack · Aurora Grid · Glass Cathedral · Silk Nebula · Choir of Machines · Warm Signal · Glacial FM · String Machine · Dawn Array · Vapor Halo · Deep Field |
| glass & bells | Terminal Bell · Neon Rain · DX Keys · Glass Marimba · Tubular · CZ Brass · Ice Piano · Crystal EP · Vapor Keys · Mallet Garden · Neon Brass · Glass Rhodes · Celesta Array · Crystal Harp · Bell Garden · Velvet EP · Music Box Grid · Tine Kalimba |
| the link | Corrupted Choir · Data Storm · Underwater · Dropout · Stutter Choir · Dial-up · Static Field · Ghost Signal · Lo-Fi Memory |
| weird | Bitwise · Modem Choir · Time Slip · Fractal · Whale · Clockwork · Neural Drone · Orbital Drone · Data Rain · Swarm Array · Frozen Signal |
| sequences | Rule 110 · Rule 30 Bass · Trance Gate · XOR Sequence · Automaton Bells · Data Runner · Stardust (maj7 chord arp) · Table Melody · Berlin Table · Gate Choir · Euclid Glass · Rule 90 Garden · Phaser Sequence · XOR Bell Sequence · Acid Table |
| plucks | Neon Pluck · Glass Pluck · Harp Stack · Data Koto · Pizz Array · Supersquare Pluck |
| leads | Laser Violin · Vector Saw · Glass Flute · Resonant Laser · Portamento Square · Choir Lead |
| fx | Riser Array · Falling Satellite · Laser Zap · Sonar Ping · Modem Dream · Power Down · Static Sleep |
| neon | Neon Pad · Neon Lead · Neon Bass · Neon Stab · Sidechain Pad · Offbeat Pump · Midnight Drive · Grid Runner · Quiet Square · Holo Bloom · Wide Open · Tunnel Vision — built on the saw channel, chorus, width and pump |

Seven more dark, sparse presets sit in the existing categories (Dial Tone,
Shipwatching, Density, Cold Boot, Relay, Hull Hum, Last Packet).

In the first bank, the 17 newest (the first three bass, and the last one or few of the others) are
stacks: three or four channels layered in
modern mode, detuned and spread across the stereo field, with **precision**
at 1 so the detune beats instead of landing on the same divider step (the
divider's resolution is about 7 cents around A4, which swallows small
detunes), slow register motion on pitch and duty, a ping-pong frame echo and
a large plate. Three new drawn waves go with them: a soft saw, a hollow
(odd-harmonic) square and a vowel-ish body.

The second bank (66, after Stardust in `params.ts`, so the host's program
numbers for the first 84 are unchanged) is built the same way, with four
more drawn waves (a brighter saw, a sparse bell, a darker choir vowel and a
warm near-sine), and adds plucks, leads and fx. Its sequences use the tables
as a step sequencer: frame sync on and 3 frames per step make each table
step a thirty-second, the pitch table holds each note for two steps and
volume table B accents the first of each pair; the tables restart with every
note, so a held chord plays the pattern from the key press. **House Machine**
plays a kick and an off-beat hat from one held low note. The new presets were
level-matched by measurement: tonal ones sit within about 2 dB of the first
bank's median loudness, drums a little below.

## UI

The FT Instrument look (`src/ft.css`) in Vector's skin (`src/style.css`): hard black-glass modules cut at two corners, titles
split into cyan and magenta, a glitching logo, and the neon city grid
scrolling underneath. Each module has its own neon (cyan for the chip,
magenta for the glass sources, violet for the registers, acid for
sequencing, orange for the tables, red for the link), exposed as
`--accent` / `--accent-rgb`, which every canvas reads.

Four views (`1`–`4`): **voice** (machine, chord, the seven channels; channels
that are off fold to one line), **motion** (frame clock, arp, filter,
registers, automaton), **tables**, **link** (transmission, echo, plate,
chorus and width, pump). The channels are full-width strips, and a channel
that is folded takes one line.
Most modules carry a picture of what they do, drawn with the chip's own
maths (`src/ui/viz.ts`): duty cycles, the drawn wavetable, the LFSR, 2-op FM,
phase distortion, the SVF response, the stepped frame echo, the gated plate,
a sine through the link. The main knobs are LED rings. Registers show as
live bit rows, the automaton scrolls like a tracker, the tables are grids
you draw in, and the scope is an XY vector display.

Presets: the browser (`` ` ``) has a category sidebar; **save** (⌘S) names
the current sound and keeps it in this browser under *yours* (delete with
×). The power button boots and halts the machine.

## The plugin (VST3 / AU)

`plugin/` builds VECTOR as a **VST3** (macOS, Windows and Linux), an **AU**
(macOS, for Logic) and a standalone app, with JUCE 8 (fetched by CMake).

```
plugin/build.sh      # web UI + params header + plugins, installed for this user
```

It installs to `~/Library/Audio/Plug-Ins/{VST3,Components}` on macOS and
`~/.vst3` on Linux. On macOS check the AU with `auval -v aumu Vect Ftft`.
On Linux it needs the usual JUCE packages plus WebKitGTK; the exact apt list
is in [`.github/workflows/build.yml`](.github/workflows/build.yml).

- **DSP**: `plugin/Source/dsp/` is a line-for-line C++ port of `src/dsp/`
  (`Chip.h`, `Machine.h` for the registers, tables and arp, `Voice.h`,
  `Effects.h` for the SVF, echo and plate, `Link.h` for the link and codec,
  `Engine.h`). Buffers the TS keeps in `Float32Array`s are `float`,
  everything else is `double`, and `Math.round` is JS's (halves towards +∞),
  so the two engines agree: `node scripts/null-test.ts` renders every preset
  with both and subtracts — every preset is bit-identical. The codec keeps its
  naive MDCT for that reason (an FFT would round differently); in C++ it is
  cheap anyway. Nothing allocates on the audio thread. About twice as fast
  as V8 (`out/vector-render bench`: 5 % of a core for eight voices of
  Sleeper Pad with the codec on).
- **Parameters**: `Params.gen.h` is generated from `params.ts`
  (`node scripts/gen-plugin.ts`, run by `build.sh`), so the host sees the same
  250 parameters with the same knob curves and value text — every cell of the
  drawn tables included, so a table can be automated. The factory bank is the
  host's program list.
- **UI**: the web UI itself (`dist/`, embedded in the binary) in a WebView;
  `src/plugin.ts` stands in for the AudioWorklet and talks to
  `PluginEditor.cpp` over JUCE's event bridge, including the live machine
  display (registers, automaton, table playheads, packet loss). The page is
  laid out at 1360 × 850 (16:10) and scaled to fit the window, with no
  scrolling. In the plugin the voice view is split over three tabs (voice,
  chip and glass), six tabs in all, and a new window opens as large as fits
  the screen, up to that size. Your saved presets are a file
  shared by every instance (`~/Library/Application Support/FT/Vector/` or
  `~/.config/FT/Vector/`). `node scripts/check-plugin-ui.ts` checks the page
  against a fake bridge.
- **Clock**: the host's tempo replaces the tempo knob, and while the host
  plays, a synced frame clock (24 ticks per beat) ticks on the host's grid.
  The arp, the chord arp and the tables still start from the note you play,
  not from the bar.

After changing anything in `src/dsp/`, port it to `plugin/Source/dsp/` and
run the null test.

In the browser: no allocation on the audio thread (typed arrays and
scalars); the codec uses an in-place typed-array sort. About 8 % of one core
for eight voices of the heaviest preset with the codec on, at 48 kHz in V8.

## Known limitations / next steps

- The codec keeps coefficients by magnitude with one quantiser step per block — no psychoacoustic model, on purpose.
- The link runs at the host rate; a real transmission would be resampled to the codec's rate first.
- Tables share one position per voice (both volume tables step together).
- The saw channel runs at the host rate, so it has none of the chip aliasing or divider detuning the other six channels are built around.

## License

Copyright (C) 2026 Filipe F. Thomaz.

VECTOR is free software under the [GNU AGPL v3](LICENSE). The plugin is built
on [JUCE](https://juce.com), which is itself AGPLv3 (or commercial), so the
whole thing is distributed under the AGPL (the bundled fonts keep their own
[SIL OFL](src/fonts/); see [THIRD-PARTY.md](THIRD-PARTY.md)): you can use it for anything,
including music you sell, and change it and share it, as long as a modified
version you distribute comes with its source under the same license.
