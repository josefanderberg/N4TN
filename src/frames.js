import * as THREE from 'three';

export class CancelledError extends Error {}

// Rejäl marginal: på en hårt belastad dator kan en enskild sökning ta flera sekunder.
function once(target, event, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout: ${event}`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Videon kunde inte läsas (format/codec stöds inte av webbläsaren).'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onEvent);
    target.addEventListener('error', onError);
  });
}

async function seek(video, time) {
  if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2) return;
  const done = once(video, 'seeked');
  video.currentTime = time;
  await done;
}

// Webm-filer från MediaRecorder saknar ofta längd tills man har sökt till slutet.
export async function resolveDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  const done = once(video, 'seeked');
  video.currentTime = 1e9;
  await done;
  const duration = video.duration;
  await seek(video, 0);
  return duration;
}

function createTexture(data, width, height, depth) {
  const texture = new THREE.Data3DTexture(data, width, height, depth);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function createVideo(src) {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  return video;
}

function releaseVideo(video) {
  video.removeAttribute('src');
  video.load();
}

// Antal videoelement som söker parallellt. Sökning är flaskhalsen, så detta ger stor vinst.
const PARALLEL = 4;

/**
 * Plockar ut `frames` jämnt fördelade bildrutor ur videon och packar dem i en 3D-textur.
 * Texturen skapas direkt (onStart) och fylls på successivt (onProgress), som även
 * rapporterar hur stor del från början som är sammanhängande ifylld.
 */
export async function extractFrames(src, { frames, size, onStart, onProgress, isCancelled }) {
  const first = createVideo(src);
  const videos = [first];

  try {
    await once(first, 'loadeddata', 20000);
    const duration = await resolveDuration(first);
    const vw = first.videoWidth;
    const vh = first.videoHeight;
    if (!vw || !vh) throw new Error('Filen innehåller ingen bild.');

    const scale = Math.min(1, size / Math.max(vw, vh));
    const width = Math.max(2, Math.round(vw * scale));
    const height = Math.max(2, Math.round(vh * scale));

    const layer = width * height * 4;
    const data = new Uint8Array(layer * frames);
    const texture = createTexture(data, width, height, frames);
    const info = { width, height, frames, duration, videoWidth: vw, videoHeight: vh };
    onStart?.(texture, info);

    // Varje arbetare tar var N:te bildruta i stigande ordning.
    const workers = Math.min(PARALLEL, frames);
    for (let k = 1; k < workers; k++) videos.push(createVideo(src));
    await Promise.all(videos.slice(1).map((v) => once(v, 'loadeddata', 20000)));

    // Medelljuset används för automatisk exponering i det adderande läget.
    let lumaSum = 0;
    let lumaCount = 0;
    let done = 0;
    // Nästa bildruta per arbetare; allt före den minsta är garanterat ifyllt.
    const next = videos.map((_, k) => k);
    const contiguous = () => Math.min(...next) / frames;
    const work = async (video, k) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (let i = k; i < frames; i += workers) {
        if (isCancelled?.()) throw new CancelledError();
        const t = Math.min(duration - 1e-3, ((i + 0.5) / frames) * duration);
        await seek(video, t);
        ctx.drawImage(video, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        data.set(pixels, i * layer);
        for (let o = 0; o < pixels.length; o += 64) {
          lumaSum += 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
          lumaCount++;
        }
        done++;
        next[k] = i + workers >= frames ? frames : i + workers;
        onProgress?.(done, frames, texture, contiguous());
      }
    };
    await Promise.all(videos.map(work));

    if (isCancelled?.()) throw new CancelledError();
    return { texture, ...info, meanLuma: lumaCount ? lumaSum / lumaCount / 255 : 0.3 };
  } finally {
    videos.forEach(releaseVideo);
  }
}

// En enkel genererad volym som visas innan någon video har laddats.
export function makeDemoVolume() {
  const w = 160;
  const h = 90;
  const d = 72;
  const data = new Uint8Array(w * h * d * 4);
  let o = 0;
  for (let z = 0; z < d; z++) {
    const t = z / (d - 1);
    const sx = 0.2 + 0.6 * t;
    const sy = 0.42 + 0.12 * Math.sin(t * Math.PI * 2);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const sky = v < 0.62;
        let r, g, b;
        if (sky) {
          r = 0.12 + 0.55 * v;
          g = 0.14 + 0.3 * v;
          b = 0.32 + 0.15 * v;
        } else {
          const stripe = Math.abs(u - 0.5 + (v - 0.62) * 0.2 * Math.sin(t * 6)) < 0.012 ? 0.6 : 0;
          r = 0.18 + stripe;
          g = 0.2 + stripe;
          b = 0.24 + stripe;
        }
        const dx = (u - sx) * (w / h);
        const dy = v - sy;
        const glow = Math.exp(-(dx * dx + dy * dy) * 60);
        r += glow * 0.95;
        g += glow * 0.35;
        b += glow * 0.2;
        data[o++] = Math.min(255, r * 255);
        data[o++] = Math.min(255, g * 255);
        data[o++] = Math.min(255, b * 255);
        data[o++] = 255;
      }
    }
  }
  return { texture: createTexture(data, w, h, d), width: w, height: h };
}
