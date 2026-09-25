# ft-vector

**VECTOR** — a clean-digital synth with its own physics. Where `ft-mycelia`
models circuits and hides that it is digital, Vector models **digital
systems themselves**: clock dividers, 8-bit registers ticked at a frame
clock, quantisers, and a transmission link that loses data. Chip squares,
glassy FM and phase-distortion, codec smear, packet stutter. Runs in the
browser; the DSP core lifts straight into a VST3/AU plugin (same shape as
`ft-mycelia` and `ft-piano`).

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

## Signal path

```
pulse 1 ─┐
pulse 2 ─┤  six chip channels, each: source → ADSR or table env → pan
wave    ─┤  (chip mode: one voice, held keys cycle at frame rate;
noise   ─┤   modern mode: 8 voices, the cycle becomes an accent)
fm      ─┤
pd      ─┘
   → echo (frames) → SVF → LINK: drift · jitter → codec → packet loss → word length · bit errors
   → plate → speaker → out
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
| `reverb.ts` | **Plate**: Mycelia's 8-line FDN skeleton re-tuned — short bright lines, light modulation, and a **gate** that holds the tail for 20–400 ms after the input stops, then cuts. |
| `voice.ts` | One voice = the six channels playing one note. Levels, pitches and duties are computed once per 32-sample chunk and ramped; envelopes step per chunk. |
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

67, grouped in a searchable browser (click the preset name or press `` ` ``, `Esc` closes); `< >` step through them in browser order, **mutate** nudges.

| category | presets |
|---|---|
| chip | Thomas (major chord arp at 60 Hz, tri bass, LFSR hat, stepped vibrato, frame echo) · Chord Stab · Slide Bass (stepped glide, xor fifth) · Ring Lead · Metal Hat · Square Bass · Duty Phaser · Tracker Lead (pitch table) · Game Boy · Mega Lead · Octave Bass · Pixel Pluck · Boss Fight · Bubble · Laser |
| arps | Crystal Run · Stairway · Cascade Bells · Neon Stepper · Rain Arp · Broken Arp · Choir Arp (note arp + chord arp) |
| tracker leads | Tracker Arp (the pitch table plays the chord) · Round Lead · Warm Square · Tracker Bell · Sweep Lead · Minor Third Lead · Octave Bounce |
| drums | Kick 8-bit · Snare Noise · Glitch Kit · Tom Divider — pitch tables and LFSR, the way chips did drums |
| pads | Sleeper Pad · Neon Choir · Hologram · Cold Storage · Server Room |
| glass | Terminal Bell · Neon Rain · DX Keys · Glass Marimba · Tubular · CZ Brass · Ice Piano |
| the link | Corrupted Choir · Data Storm · Underwater · Dropout · Stutter Choir · Dial-up · Static Field · Ghost Signal |
| weird | Bitwise · Modem Choir · Time Slip · Fractal · Whale · Clockwork · Neural Drone |
| sequences | Rule 110 · Rule 30 Bass · Trance Gate · XOR Sequence · Automaton Bells · Data Runner |

## UI

The FT Instrument look (`src/ft.css`, shared with Mycelia) in Vector's
skin (`src/style.css`): hard black-glass modules cut at two corners, titles
split into cyan and magenta, a glitching logo, and the neon city grid
scrolling underneath. Each module has its own neon (cyan for the chip,
magenta for the glass sources, violet for the registers, acid for
sequencing, orange for the tables, red for the link), exposed as
`--accent` / `--accent-rgb`, which every canvas reads.

Four views (`1`–`4`): **voice** (machine, chord, the six channels; channels
that are off fold to one line), **motion** (frame clock, arp, filter,
registers, automaton), **tables**, **link** (transmission, echo, plate).
Most modules carry a picture of what they do, drawn with the chip's own
maths (`src/ui/viz.ts`): duty cycles, the drawn wavetable, the LFSR, 2-op FM,
phase distortion, the SVF response, the stepped frame echo, the gated plate,
a sine through the link. The main knobs are LED rings. Registers show as
live bit rows, the automaton scrolls like a tracker, the tables are grids
you draw in, and the scope is an XY vector display.

Presets: the browser (`` ` ``) has a category sidebar; **save** (⌘S) names
the current sound and keeps it in this browser under *yours* (delete with
×). The power button boots and halts the machine.

## Porting to a plugin (JUCE)

- `VectorEngine(sampleRate)` ↔ `prepareToPlay`
- `noteOn / noteOff / controlChange / pitchBend` ↔ the MIDI buffer in `processBlock`
- `process(L, R, n)` ↔ the audio buffer (any `n`; it chunks internally in 32s)
- `setParam(id, value)` ↔ `AudioProcessorValueTreeState`, using `PARAMS` as the list
- the frame clock syncs to the internal `tempo`; in a plugin, feed it the host tempo instead

No allocation on the audio thread (typed arrays and scalars); the codec
uses an in-place typed-array sort. About 8 % of one core for eight voices
of the heaviest preset with the codec on, at 48 kHz in V8; the codec's
naive O(N²) MDCT is most of it and is the first thing to FFT in C++.

## Known limitations / next steps

- The codec keeps coefficients by magnitude with one quantiser step per block — no psychoacoustic model, on purpose.
- The link runs at the host rate; a real transmission would be resampled to the codec's rate first.
- Tables share one position per voice (both volume tables step together).
- Presets can be copied as JSON but not saved in the browser yet.
