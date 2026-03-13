# Living Cayley Graph Visualizer

Real-time audio visualizer inspired by group theory and Fourier analysis:

- Signal is sampled in windows and transformed with FFT.
- Spectrum is stored on a toroidal lattice (`Z_N x Z_M`).
- Beat events trigger generator-like shifts on the Cayley graph.
- Diffusion and random walks animate energy flow across neighbors.
- A second 2D mode visualizes time-axis Fourier characters of `Z_N`.
- Excitement-based morphing blends from the 2D character view into the 3D Cayley torus.

## Run

Because this uses ES modules in the browser, serve the folder with a local web server.

For YouTube link loading, use the Node server mode (it exposes `/api/youtube` and calls `yt-dlp`).

### Option A: Python

```bash
python -m http.server 5173
```

Then open:

`http://localhost:5173`

### Option B: Node (if installed)

```bash
npx serve .
```

### Option C: Node Server With YouTube Support (recommended)

```bash
npm start
```

## Controls

- `Load Audio File`: choose a local file (manual play; looped once started).
- `YouTube URL` + `Load YouTube Link`: resolves a YouTube link to a playable audio stream (requires Node server mode + `yt-dlp`).
- `Play / Pause`: toggles file playback.
- `Gain`: output gain.
- `Diffusion`: controls neighbor energy spread on the graph.
- `Height Scale`: amplitude-to-geometry displacement.
- `3D Threshold`: excitement level where the scene moves from 2D toward 3D.
- `BG Wave Opacity`: controls the faded waveform intensity on the black background.
- `3D Scene Mode`: cycles through:
  - Original Torus
  - Free-Group Flower
  - Hybrid Linked Torus (flower nodes connect to torus surface)
  - Free Pulse Form (unprojected free-group oscillation)

## Visual Mapping

- Torus major angle (`u`) tracks recent time windows.
- Torus minor angle (`v`) indexes log-frequency bands.
- Vertex displacement encodes spectral amplitude.
- Vertex color encodes phase + timbral drift.
- Particles perform random walks on graph generators.
- Character Wheel mode:
  - each spoke corresponds to a Fourier character index of `Z_N`.
  - spoke length encodes character magnitude.
  - orbit point angle encodes character phase under time-shift action.

## Math Notes

For a finite cyclic setup:

- Group: `G = Z_N x Z_M`
- Characters: `chi_(k,l)(x,y) = exp(2pi i (kx/N + ly/M))`
- FFT approximates coefficients of these basis functions in each frame.

The app treats each frame as a new column on the `Z_N` axis and diffuses values over graph-neighbor edges to create a "living" Cayley graph.

For the 2D mode, a simpler finite-group picture is used:

- Group: `Z_N` (time shifts modulo `N`).
- A shift action rotates character phases.
- The drawing exposes this action directly as evolving phase orbits and magnitudes.

The code is organized into modules under `src/`:

- `audio-engine.js` for audio input and FFT feature extraction.
- `original-torus-view.js` for the Cayley torus mesh.
- `free-group-flower-view.js` for the free-group growth projection on a torus.
- `fft-utils.js` and `math-utils.js` for reusable math helpers.

## Free-Group Generator Config

You can change the free-group setup directly in `main.js`:

- `FREE_GROUP_BASE_GENERATORS`: base generator symbols (for example `['a', 'b']` or `['a', 'b', 'c']`).
- `FREE_GROUP_VECTOR_DIMENSIONS`: algebra-space dimension used before projection to 3D.

The flower module then auto-builds:

- full symbol list with inverses (`a, A, b, B, ...`)
- inverse lookup map (`a <-> A`, `b <-> B`, or `g <-> g^-1`)
- generator direction vectors used by branch growth

No hardcoded generator/inverse tables are needed anymore.
