// Denne fil kører i baggrunden (en "Web Worker"), så siden ikke fryser,
// mens sprogmodellen arbejder. Den modtager lyd i stykker á højst 30 sekunder
// og sender teksten tilbage. Intet sendes ud af computeren: modellen hentes
// én gang fra Hugging Face og gemmes derefter i browseren.

import { pipeline, env } from './vendor/transformers.js';

// Skift model her, når den danske model (røst) er klar i ONNX-format.
const MODEL = 'onnx-community/whisper-small';
const LANGUAGE = 'danish';

env.allowLocalModels = false;
// Programmet, der regner modellen igennem (ONNX Runtime), ligger i appens egen
// mappe i stedet for at blive hentet fra en fremmed server.
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('./vendor/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  wasm: new URL('./vendor/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
};

let transcriber = null;
let loading = null;

function progressCallback(info) {
  if (info.status === 'progress_total') {
    self.postMessage({ type: 'progress', loaded: info.loaded, total: info.total });
  }
}

async function webgpuAdapter() {
  try {
    return navigator.gpu ? await navigator.gpu.requestAdapter() : null;
  } catch {
    return null;
  }
}

async function load() {
  let device = 'wasm';
  if (await webgpuAdapter()) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback: progressCallback,
      });
      device = 'webgpu';
    } catch (err) {
      console.warn('WebGPU virkede ikke, skifter til WASM', err);
      transcriber = null;
    }
  }
  if (!transcriber) {
    transcriber = await pipeline('automatic-speech-recognition', MODEL, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: progressCallback,
    });
  }
  // En kort prøvekørsel, så første rigtige stykke ikke er ekstra langsomt.
  await transcriber(new Float32Array(16000), { language: LANGUAGE, task: 'transcribe' });
  return device;
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'load') {
      loading ??= load();
      const device = await loading;
      self.postMessage({ type: 'ready', device, model: MODEL });
    } else if (msg.type === 'transcribe') {
      const output = await transcriber(msg.audio, { language: LANGUAGE, task: 'transcribe' });
      self.postMessage({ type: 'result', id: msg.id, text: output.text });
    }
  } catch (err) {
    if (msg.type === 'load') {
      loading = null;
      transcriber = null;
    }
    self.postMessage({ type: 'error', id: msg.id, message: String(err?.message ?? err) });
  }
};
