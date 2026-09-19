// AI-djupet: en liten djupskattningsmodell (Depth Anything V2 small) körs helt
// i webbläsaren via transformers.js. Modellen hämtas första gången knappen
// trycks och läggs i webbläsarens cache; inget ur klippet laddas upp någonstans.
//
// Djupet beräknas för ett antal nyckelrutor och tonas fram linjärt däremellan,
// eftersom modellen tar någon sekund per bildruta. Normaliseringen görs över
// alla nyckelrutor tillsammans, annars flimrar reliefen mellan bildrutorna.

import * as THREE from 'three';
import { CancelledError } from './frames.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';
const MODEL_ID = 'onnx-community/depth-anything-v2-small';

let pipePromise = null;

async function loadPipeline(onProgress) {
  const { pipeline } = await import(/* @vite-ignore */ TRANSFORMERS_URL);
  const opts = { progress_callback: onProgress };
  // WebGPU är många gånger snabbare där det finns; annars WASM med en
  // kvantiserad modell, som är mindre att hämta och snällare mot minnet.
  if (navigator.gpu) {
    try {
      return await pipeline('depth-estimation', MODEL_ID, { ...opts, device: 'webgpu', dtype: 'fp16' });
    } catch (err) {
      console.warn('WebGPU gick inte att använda för djupmodellen, provar WASM.', err);
    }
  }
  return pipeline('depth-estimation', MODEL_ID, { ...opts, device: 'wasm', dtype: 'q8' });
}

function getPipeline(onProgress) {
  pipePromise ??= loadPipeline(onProgress).catch((err) => {
    pipePromise = null;
    throw err;
  });
  return pipePromise;
}

// En bildruta ur 3D-texturens råbuffert som data-URL, formen modellen tar emot.
function frameUrl(image, index) {
  const { width, height, data } = image;
  const layer = width * height * 4;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset + index * layer, layer);
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

// Modellens karta har sin egen storlek; skalas bilinjärt till bildrutans.
function resizeMap(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) / dh) * sh - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) / dw) * sw - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, fx - x0));
      const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const bottom = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      out[y * dw + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

export function depthTexture(data, width, height, depth) {
  const texture = new THREE.Data3DTexture(data, width, height, depth);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Skattar djupet för volymens bildrutor. `image` är 3D-texturens image-objekt
 * (data, width, height, depth). Ger en enkanalig 3D-textur där 255 = närmast.
 */
export async function estimateDepth(image, { keyframes = 12, onProgress, isCancelled }) {
  const { width, height, depth: frames } = image;
  const count = Math.max(2, Math.min(keyframes, frames));

  const pipe = await getPipeline((info) => {
    if (info.status === 'progress' && info.file?.endsWith('.onnx')) {
      onProgress?.('Hämtar djupmodellen…', (info.progress || 0) / 100);
    }
  });
  if (isCancelled?.()) throw new CancelledError();

  // Nyckelrutorna sprids från första till sista bildrutan.
  const indices = [];
  for (let k = 0; k < count; k++) {
    indices.push(Math.round((k * (frames - 1)) / (count - 1)));
  }

  const maps = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < count; k++) {
    if (isCancelled?.()) throw new CancelledError();
    onProgress?.(`Beräknar djup… ${k + 1}/${count} nyckelrutor`, (k + 0.2) / count);
    const result = await pipe(frameUrl(image, indices[k]));
    const tensor = result.predicted_depth;
    const [mh, mw] = tensor.dims.slice(-2);
    const map = resizeMap(tensor.data, mw, mh, width, height);
    for (const v of map) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    maps.push(map);
  }
  if (isCancelled?.()) throw new CancelledError();

  // Mellanliggande bildrutor tonas fram mellan sina två närmaste nyckelrutor.
  const layer = width * height;
  const out = new Uint8Array(layer * frames);
  const span = Math.max(hi - lo, 1e-6);
  for (let f = 0; f < frames; f++) {
    let k = 0;
    while (k < count - 2 && indices[k + 1] < f) k++;
    const a = maps[k];
    const b = maps[k + 1];
    const gap = Math.max(indices[k + 1] - indices[k], 1);
    const w = Math.min(1, Math.max(0, (f - indices[k]) / gap));
    const base = f * layer;
    for (let i = 0; i < layer; i++) {
      const v = (a[i] * (1 - w) + b[i] * w - lo) / span;
      out[base + i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }

  return { texture: depthTexture(out, width, height, frames), keyframes: count };
}
