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

// Bakgrundsbilden: tidsmedianen per bildpunkt och kanal över alla bildrutor.
// Det som rör sig passerar snabbt förbi och röstas bort; kvar blir det stilla.
export function medianBackground(data, width, height, frames) {
  const layer = width * height * 4;
  const out = new Uint8Array(width * height * 4);
  const hist = new Uint32Array(256);
  const half = frames >> 1;
  for (let px = 0; px < width * height; px++) {
    const base = px * 4;
    for (let ch = 0; ch < 3; ch++) {
      hist.fill(0);
      for (let f = 0; f < frames; f++) hist[data[f * layer + base + ch]]++;
      let cum = 0;
      for (let v = 0; v < 256; v++) {
        cum += hist[v];
        if (cum > half) {
          out[base + ch] = v;
          break;
        }
      }
    }
    out[base + 3] = 255;
  }
  return out;
}

export function backgroundTexture(data, width, height, frames) {
  const texture = new THREE.DataTexture(
    medianBackground(data, width, height, frames),
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
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
  video.load();
  return video;
}

function releaseVideo(video) {
  video.removeAttribute('src');
  video.load();
}

// Antal videoelement som söker parallellt. Sökning är flaskhalsen, så detta ger
// stor vinst — men en telefon har få avkodare, och fler element än så gör bara
// att de köar eller vägrar starta. Uppspelningsvideon tar dessutom en av dem.
function parallelLimit() {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return touch ? 2 : 4;
}

/**
 * Plockar ut `frames` jämnt fördelade bildrutor ur videon och packar dem i en 3D-textur.
 * Texturen skapas direkt (onStart) och fylls på successivt (onProgress), som även
 * rapporterar hur stor del från början som är sammanhängande ifylld.
 */
export async function extractFrames(src, { frames, size, onStart, onProgress, isCancelled }) {
  const first = createVideo(src);
  const videos = [first];

  try {
    await once(first, 'loadeddata', 20000).catch((err) => {
      throw err.message.startsWith('Timeout')
        ? new Error('Videon gick inte att läsa för bygget. Tryck Bygg om volym igen.')
        : err;
    });
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

    // Varje arbetare tar var N:te bildruta i stigande ordning. Extraelementen är
    // en ren snabbhetsvinst, så de som inte kommer igång lämnas därhän i stället
    // för att fälla hela bygget.
    const wanted = Math.min(parallelLimit(), frames);
    for (let k = 1; k < wanted; k++) videos.push(createVideo(src));
    const started = await Promise.allSettled(
      videos.slice(1).map((v) => once(v, 'loadeddata', 20000)));
    const crew = [first, ...videos.slice(1).filter((_, i) => started[i].status === 'fulfilled')];
    const workers = crew.length;

    // Medelljuset används för automatisk exponering i det adderande läget.
    let lumaSum = 0;
    let lumaCount = 0;
    let done = 0;
    // Nästa bildruta per arbetare; allt före den minsta är garanterat ifyllt.
    const next = crew.map((_, k) => k);
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
    await Promise.all(crew.map(work));

    if (isCancelled?.()) throw new CancelledError();
    return { texture, ...info, meanLuma: lumaCount ? lumaSum / lumaCount / 255 : 0.3 };
  } finally {
    videos.forEach(releaseVideo);
  }
}

// En genererad demoscen som visas innan någon video har laddats: en väg med
// mittlinje och en röd bil som rör sig. Den har rörelse i bilden, så att
// tidskuben visar samma sorts struktur som ett riktigt klipp gör.
export function makeDemoVolume() {
  const w = 192;
  const h = 108;
  const d = 96;
  const data = new Uint8Array(w * h * d * 4);
  const HORIZON = 0.42;
  let o = 0;

  for (let z = 0; z < d; z++) {
    const t = z / d;
    const carX = 0.5 + 0.3 * Math.sin(t * Math.PI * 2);
    const carY = 0.64 + 0.08 * Math.sin(t * Math.PI * 2 * 0.7);
    const carSize = 0.85 + 0.45 * Math.sin(t * Math.PI * 2 * 0.7);
    const dash = t * 6;

    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        let r;
        let g;
        let b;

        if (v < HORIZON) {
          // Skymningshimmel som ljusnar ner mot horisonten.
          const k = v / HORIZON;
          r = 0.13 + 0.22 * k;
          g = 0.17 + 0.20 * k;
          b = 0.28 + 0.16 * k;
        } else {
          // Vägen breder ut sig mot betraktaren.
          const far = (v - HORIZON) / (1 - HORIZON);
          const halfRoad = 0.06 + 0.42 * far;
          const side = Math.abs(u - 0.5);
          if (side < halfRoad) {
            r = 0.19 + 0.05 * far;
            g = 0.19 + 0.05 * far;
            b = 0.2 + 0.05 * far;
            // Streckad mittlinje som rusar mot betraktaren.
            const dashWidth = 0.004 + 0.012 * far;
            if (side < dashWidth && (far * 3 + dash) % 1 < 0.45) {
              r = 0.85;
              g = 0.85;
              b = 0.72;
            }
          } else {
            const shade = 0.5 + 0.5 * far;
            r = 0.07 * shade;
            g = 0.16 * shade;
            b = 0.09 * shade;
          }
        }

        // Bilen: kaross och ett mörkare tak.
        const dx = (u - carX) / (0.075 * carSize);
        const dy = (v - carY) / (0.045 * carSize);
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
          const roof = dy < -0.25 && Math.abs(dx) < 0.72;
          r = roof ? 0.42 : 0.72;
          g = roof ? 0.17 : 0.14;
          b = roof ? 0.15 : 0.1;
          if (dy > 0.55 && Math.abs(dx) > 0.55) {
            r = 0.95;
            g = 0.55;
            b = 0.35;
          }
        }

        data[o++] = Math.min(255, r * 255);
        data[o++] = Math.min(255, g * 255);
        data[o++] = Math.min(255, b * 255);
        data[o++] = 255;
      }
    }
  }
  return { texture: createTexture(data, w, h, d), width: w, height: h };
}
