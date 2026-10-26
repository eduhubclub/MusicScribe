/**
 * In-browser inference spike (honest stub — not wired to the pipeline yet).
 *
 * Feasible later in-tab (ONNX Runtime Web / WASM / WebGPU), with real engineering:
 *   - Chord chroma + HMM (already mostly NumPy/librosa-class work)
 *   - Basic Pitch ONNX note detection (model already ONNX on the Python side)
 *   - Lightweight onset / drum-band heuristics
 *
 * Not feasible as a drop-in today without a major port:
 *   - Demucs-class source separation (large PyTorch; needs WebGPU port or smaller
 *     separator, or keep a localhost-only helper)
 *   - faster-whisper at full quality (possible via WASM whisper.cpp later; large download)
 *
 * Until those land, Music Scribe uses a localhost-only Python helper. Audio never
 * uploads to a cloud API. See docs/browser-local-architecture.md.
 */
window.MusicScribeInference = {
  status: "stub",
  inBrowser: {
    chords: "planned",
    basicPitch: "planned-onnx",
    drumsHeuristics: "planned",
    demucs: "not-in-browser",
    whisper: "maybe-wasm-later",
  },
  async probe() {
    return {
      webgpu: !!(navigator.gpu),
      wasm: typeof WebAssembly !== "undefined",
      onnxRuntimeWeb: false,
      note: "No in-tab models loaded; localhost helper required for separation/ASR/AMT.",
    };
  },
};
