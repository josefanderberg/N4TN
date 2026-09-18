import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VolumeBox } from './volume.js';
import { CancelledError, extractFrames, makeDemoVolume } from './frames.js';
import { buildPanel } from './ui.js';
import { CanvasRecorder, downloadBlob, pickMimeType } from './recorder.js';
import { decodeSettings, encodeSettings } from './code.js';

const DEFAULTS = {
  frames: 144,
  size: 320,

  content: 1,
  motionGain: 8,
  blend: 1,
  density: 2.6,
  lumWeight: 0.4,
  wave: 0.7,
  waveWidth: 0.3,
  edgeFade: 0,
  sliceWave: 0,
  sliceWaveWidth: 0.3,
  special: false,
  specialReverse: false,
  specialAmount: 1,
  shellFront: 0.75,
  shellBack: 0.6,
  brightness: 1.1,
  saturation: 0.9,
  glass: 1,
  edgeGlow: 0.6,
  lines: 0.3,
  depth: 1.3,
  sizeFront: 1,
  sizeBack: 1,
  flipTime: false,
  steps: 200,

  timeOn: true,
  timeCount: 1,
  timeFollow: true,
  timePos: 0,
  timeOpacity: 0.92,
  timeRestOpacity: 0.55,
  timeFull: 1,
  timeCurve: 1,
  xCount: 0,
  xPos: 0.5,
  xSweep: false,
  xOpacity: 0.3,
  yCount: 0,
  yPos: 0.5,
  ySweep: false,
  yOpacity: 0.3,

  speed: 1,
  followSlice: true,
  motion: 'free',
  motionSpeed: 0.5,
  fov: 32,
  background: '#000000',

  format: '1080x1080',
  fps: 30,
  bitrate: 16,
  audio: true,
  loops: 1,
};

// Versionen bumpas när standardvärdena ändras, annars vinner gamla sparade inställningar.
const STORAGE_KEY = 'n4tn.params.v3';
const PRESET_KEY = 'n4tn.presets.v1';
const DEMO_DURATION = 6;

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULTS, ...sanitize(saved) };
  } catch {
    return { ...DEFAULTS };
  }
}

let saveTimer = 0;
function saveParams() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch {
      // Inställningarna sparas bara om webbläsaren tillåter det.
    }
  }, 300);
}

const params = loadParams();

// Rent utseende i panelen, inget som hör till bilden och sparas därför inte.
const ui = {
  sliceTab: 'time',
  waveTab: 'played',
  // Djupet över reglagets max öppnar det fria läget direkt.
  depthExpanded: params.depth > 5,
};

function loadPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function storePresets(presets) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

// Bara kända nycklar med rätt typ tas in, så en gammal eller handredigerad fil
// inte kan sätta appen i ett trasigt läge.
function sanitize(values) {
  const clean = {};
  if (!values || typeof values !== 'object') return clean;
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof values[key] === typeof DEFAULTS[key]) clean[key] = values[key];
  }
  // Sparat från när uttoningen mellan snitten var relativ (timeFade): räkna om
  // till bottenopaciteten, så gamla förval och koder ser ut som de gjorde.
  if (typeof values.timeFade === 'number' && clean.timeRestOpacity === undefined) {
    const top = typeof clean.timeOpacity === 'number' ? clean.timeOpacity : DEFAULTS.timeOpacity;
    clean.timeRestOpacity = Math.round(top * (1 - values.timeFade) * 100) / 100;
  }
  return clean;
}

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const stage = $('stage');
const frame = $('frame');

const state = {
  sourceUrl: null,
  sourceName: '',
  hasVideo: false,
  building: false,
  exporting: false,
  loadToken: 0,
  buildId: 0,
  muted: false,
  demoTime: 0,
  sweepTime: 0,
  builtWith: null,
};

// --- Rendering -----------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(params.fov, 1, 0.01, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 0.8;
controls.maxDistance = 400;

const volume = new VolumeBox();
scene.add(volume.group);

const demo = makeDemoVolume();
volume.setVolume(demo.texture);
volume.setAspect(demo.width / demo.height);

// Uppspelningsvideon. Den ligger i DOM:en (osynlig) så att bildrutorna uppdateras pålitligt.
const video = document.createElement('video');
video.className = 'hidden-video';
video.crossOrigin = 'anonymous';
video.playsInline = true;
video.loop = true;
video.preload = 'auto';
document.body.append(video);

const videoTexture = new THREE.VideoTexture(video);
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.generateMipmaps = false;

function exportSize() {
  const [w, h] = params.format.split('x').map(Number);
  return { width: w, height: h };
}

function layout() {
  if (state.exporting) return;
  const { width: fw, height: fh } = exportSize();
  const rect = stage.getBoundingClientRect();
  const scale = Math.min(rect.width / fw, rect.height / fh);
  const w = Math.max(1, Math.floor(fw * scale));
  const h = Math.max(1, Math.floor(fh * scale));
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

new ResizeObserver(layout).observe(stage);

const VIEW_AZIMUTH = THREE.MathUtils.degToRad(32);
const VIEW_ELEVATION = THREE.MathUtils.degToRad(17);
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _corner = new THREE.Vector3();

// Placerar kameran så att hela lådan precis får plats i bilden, oavsett bildformat.
function fitCamera() {
  const size = volume.size;
  _dir.set(
    Math.sin(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
    Math.sin(VIEW_ELEVATION),
    Math.cos(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
  ).normalize();
  _right.set(0, 1, 0).cross(_dir).normalize();
  _up.crossVectors(_dir, _right).normalize();

  let maxRight = 0;
  let maxUp = 0;
  let maxDepth = 0;
  for (let i = 0; i < 8; i++) {
    // Tratten: framsidans hörn (z = +0.5) skalas med Storlek fram, baksidans med bak.
    const w = i & 4 ? params.sizeFront : params.sizeBack;
    _corner.set(
      (i & 1 ? 0.5 : -0.5) * size.x * w,
      (i & 2 ? 0.5 : -0.5) * size.y * w,
      (i & 4 ? 0.5 : -0.5) * size.z,
    );
    maxRight = Math.max(maxRight, Math.abs(_corner.dot(_right)));
    maxUp = Math.max(maxUp, Math.abs(_corner.dot(_up)));
    maxDepth = Math.max(maxDepth, _corner.dot(_dir));
  }

  const tanV = Math.tan(THREE.MathUtils.degToRad(params.fov) / 2);
  const tanH = tanV * camera.aspect;
  const distance = Math.max(maxRight / tanH, maxUp / tanV) * 1.1 + maxDepth;

  controls.target.set(0, 0, 0);
  camera.position.copy(_dir).multiplyScalar(distance);
  controls.update();
  anchorMotion();
}

// --- Kamerarörelse -------------------------------------------------------

const motion = { t: 0, theta: 0, phi: 0, interacting: false };
const PENDULUM_THETA = 0.55;
const PENDULUM_PHI = 0.12;
const _offset = new THREE.Vector3();
const _spherical = new THREE.Spherical();

function anchorMotion() {
  _offset.copy(camera.position).sub(controls.target);
  _spherical.setFromVector3(_offset);
  motion.theta = _spherical.theta - PENDULUM_THETA * Math.sin(motion.t);
  motion.phi = _spherical.phi - PENDULUM_PHI * Math.sin(motion.t * 0.7);
}

controls.addEventListener('start', () => {
  motion.interacting = true;
});
controls.addEventListener('end', () => {
  motion.interacting = false;
  anchorMotion();
});

function updateCamera(dt) {
  controls.autoRotate = params.motion === 'rotate' && !motion.interacting;
  controls.autoRotateSpeed = params.motionSpeed * 6;

  if (params.motion === 'pendulum' && !motion.interacting) {
    motion.t += dt * params.motionSpeed * 1.6;
    _offset.copy(camera.position).sub(controls.target);
    _spherical.setFromVector3(_offset);
    _spherical.theta = motion.theta + PENDULUM_THETA * Math.sin(motion.t);
    _spherical.phi = THREE.MathUtils.clamp(
      motion.phi + PENDULUM_PHI * Math.sin(motion.t * 0.7),
      0.05,
      Math.PI - 0.05,
    );
    camera.position.setFromSpherical(_spherical).add(controls.target);
  }

  if (camera.fov !== params.fov) {
    camera.fov = params.fov;
    camera.updateProjectionMatrix();
  }
  controls.update(dt);
}

// Kameran kan åka med tidssnittet genom lådan. Mål och kamera flyttas lika
// mycket, så avståndet och vinkeln till snittet är oförändrade; när klippet
// börjar om hoppar snittet tillbaka till framkanten och kameran med det.
function followSlice(timePos) {
  const desired = params.followSlice
    ? (0.5 - timePos) * (params.flipTime ? -1 : 1) * volume.size.z
    : 0;
  const delta = desired - controls.target.z;
  if (Math.abs(delta) < 1e-6) return;
  controls.target.z += delta;
  camera.position.z += delta;
}

// Special: djupsnitten vrids mot kamerans vinkel kring mittpunkten, så att de
// står på diagonalen men behåller sin ordning genom lådan.
function tiltFromCamera() {
  if (!params.special) return 0;
  const azimuth = Math.atan2(
    camera.position.x - controls.target.x,
    camera.position.z - controls.target.z,
  );
  const sign = params.specialReverse ? 1 : -1;
  return sign * azimuth * params.specialAmount;
}

// --- Renderloop ----------------------------------------------------------

const timer = new THREE.Timer();
timer.connect(document);
const frameParams = { ...params };

function currentTimeFraction() {
  if (state.hasVideo) {
    return video.duration ? THREE.MathUtils.clamp(video.currentTime / video.duration, 0, 1) : 0;
  }
  return (state.demoTime % DEMO_DURATION) / DEMO_DURATION;
}

function tick(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  if (!state.hasVideo) state.demoTime += dt;
  if (params.xSweep || params.ySweep) state.sweepTime += dt * 0.5;

  Object.assign(frameParams, params);
  frameParams.timePosEffective = params.timeFollow ? currentTimeFraction() : params.timePos;
  followSlice(frameParams.timePosEffective);
  updateCamera(dt);
  frameParams.tilt = tiltFromCamera();
  frameParams.xPosEffective = params.xSweep
    ? 0.5 + 0.45 * Math.sin(state.sweepTime)
    : params.xPos;
  // Egen takt för höjdleden, annars rör sig de två snitten i lås med varandra.
  frameParams.yPosEffective = params.ySweep
    ? 0.5 + 0.45 * Math.sin(state.sweepTime * 0.73 + 1.1)
    : params.yPos;
  volume.update(camera, frameParams);

  renderer.setClearColor(params.background);
  renderer.render(scene, camera);
  updateTransport();
}

layout();
fitCamera();
renderer.setAnimationLoop(tick);

// --- Ljud ----------------------------------------------------------------

let audio = null;

function ensureAudio() {
  if (!audio) {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(video);
    const speaker = ctx.createGain();
    const recording = ctx.createMediaStreamDestination();
    source.connect(speaker).connect(ctx.destination);
    source.connect(recording);
    audio = { ctx, speaker, recording };
    video.muted = false;
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  applyMute();
  return audio;
}

function applyMute() {
  if (audio) audio.speaker.gain.value = state.muted ? 0 : 1;
  else video.muted = state.muted;
  $('icon-sound').hidden = state.muted;
  $('icon-muted').hidden = !state.muted;
}

// --- Laddning ------------------------------------------------------------

const busy = $('busy');
const busyLabel = $('busy-label');
const busyBar = $('busy-bar');
const busyCancel = $('busy-cancel');
let busyCancelAction = null;

function showBusy(label, fraction, cancel = null, cancelLabel = 'Avbryt') {
  busy.hidden = false;
  busyLabel.textContent = label;
  busyBar.style.width = `${Math.round(fraction * 100)}%`;
  busyCancelAction = cancel;
  busyCancel.hidden = !cancel;
  busyCancel.textContent = cancelLabel;
}

function hideBusy() {
  busy.hidden = true;
  busyCancelAction = null;
}

busyCancel.addEventListener('click', () => busyCancelAction?.());

function setStatus(text) {
  const note = $('export-status');
  if (note) note.textContent = text;
}

// En telefon kan låta bli att hämta videon tills skärmen rörs, och då kommer
// varken händelsen eller ett fel — därför en tidsgräns, så att väntan syns.
function waitFor(target, event, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener('error', fail);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('Videon kunde inte spelas upp i webbläsaren.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Videon startade inte. Tryck Försök igen.'));
    }, timeoutMs);
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

async function openSource(url, name) {
  if (state.exporting) return;
  const token = ++state.loadToken;
  const previousUrl = state.sourceUrl;
  state.sourceUrl = url;
  state.sourceName = name;
  $('file-name').textContent = name;
  $('empty-hint').hidden = true;
  busyIsError = false;
  showBusy('Läser in video…', 0, () => {
    state.loadToken++;
    hideBusy();
  });

  try {
    video.src = url;
    video.load();
    await waitFor(video, 'loadedmetadata');
    if (token !== state.loadToken) return;
    if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);

    state.hasVideo = true;
    volume.setVideo(videoTexture);
    volume.setAspect(video.videoWidth / video.videoHeight);
    fitCamera();
    video.playbackRate = Number(speedSelect.value);
    play();
    syncPanel();
  } catch (err) {
    if (token !== state.loadToken) return;
    state.hasVideo = false;
    state.sourceUrl = null;
    state.builtWith = null;
    volume.setVideo(null);
    // Ett nytt försök startar från en knapptryckning, vilket är precis vad en
    // webbläsare som höll igen på videon väntade på.
    showError(err, () => openSource(url, name));
    syncPanel();
    return;
  }

  await buildVolume();
}

async function buildVolume() {
  if (!state.sourceUrl) return;
  const token = state.loadToken;
  const buildId = ++state.buildId;
  const settings = { frames: params.frames, size: params.size };
  state.building = true;
  state.builtWith = null;
  busyIsError = false;
  syncPanel();
  const cancel = () => {
    state.loadToken++;
  };
  showBusy('Läser in video…', 0, cancel);

  // Varje uppdatering laddar upp hela 3D-texturen, så förhandsvisningen strypes i tid.
  let nextUpload = 0;

  try {
    const built = await extractFrames(state.sourceUrl, {
      ...settings,
      isCancelled: () => token !== state.loadToken,
      onStart: (texture, info) => {
        volume.setVolume(texture);
        volume.setFilled(0);
        volume.setAspect(info.width / info.height);
        volume.setFrameCount(info.frames);
      },
      onProgress: (done, total, texture, filled) => {
        const now = performance.now();
        if (now >= nextUpload || done === total) {
          nextUpload = now + 300;
          texture.needsUpdate = true;
          volume.setFilled(filled);
        }
        showBusy(`Bygger volym… ${done}/${total} bildrutor`, done / total, cancel);
      },
    });
    state.builtWith = settings;
    volume.setExposure(built.meanLuma);
  } catch (err) {
    if (!(err instanceof CancelledError)) showError(err);
  } finally {
    if (buildId === state.buildId) {
      state.building = false;
      if (!busyIsError) hideBusy();
      syncPanel();
    }
  }
}

let busyIsError = false;

function showError(err, retry = null) {
  console.error(err);
  busyIsError = true;
  showBusy(err?.message || 'Något gick fel.', 0, () => {
    busyIsError = false;
    hideBusy();
    retry?.();
  }, retry ? 'Försök igen' : 'Stäng');
}

function openFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|ogv)$/i.test(file.name)) {
    showError(new Error(`"${file.name}" verkar inte vara en videofil.`));
    return;
  }
  // Säger webbläsaren nej till ljudkopplingen ska klippet ändå gå att ladda in.
  try {
    ensureAudio();
  } catch (err) {
    console.warn('Ljudet kunde inte kopplas in.', err);
  }
  openSource(URL.createObjectURL(file), file.name);
}

$('open-btn').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => {
  openFile(e.target.files[0]);
  e.target.value = '';
});

// Dra och släpp
const dropOverlay = $('drop-overlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files') || state.exporting) return;
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  if (!state.exporting) openFile(e.dataTransfer?.files?.[0]);
});

// --- Uppspelning ---------------------------------------------------------

const playBtn = $('play-btn');
const scrub = $('scrub');
const timeLabel = $('time-label');
const speedSelect = $('speed');
const iconPlay = $('icon-play');
const iconPause = $('icon-pause');
let scrubbing = false;

function play() {
  if (!state.hasVideo) return;
  video.play().catch(() => {
    // Autouppspelning kan blockeras tills användaren klickar.
  });
}

function togglePlay() {
  if (!state.hasVideo || state.exporting) return;
  ensureAudio();
  if (video.paused) play();
  else video.pause();
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function updateTransport() {
  const enabled = state.hasVideo && !state.exporting;
  playBtn.disabled = !enabled;
  scrub.disabled = !enabled;
  speedSelect.disabled = !enabled;
  syncSpeed();
  if (state.hasVideo && !state.exporting && video.playbackRate !== params.speed) {
    video.playbackRate = params.speed;
  }
  iconPlay.hidden = !video.paused;
  iconPause.hidden = video.paused;
  if (!state.hasVideo) return;
  const duration = video.duration || 0;
  timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
  if (!scrubbing && duration) scrub.value = String(Math.round((video.currentTime / duration) * 1000));
}

playBtn.addEventListener('click', togglePlay);
scrub.addEventListener('input', () => {
  scrubbing = true;
  if (video.duration) video.currentTime = (Number(scrub.value) / 1000) * video.duration;
});
scrub.addEventListener('change', () => {
  scrubbing = false;
});
speedSelect.addEventListener('change', (e) => {
  params.speed = Number(e.target.value);
  video.playbackRate = params.speed;
  saveParams();
});

// Hastigheten kan också komma från en sparad inställning eller en delad kod.
function syncSpeed() {
  const value = String(params.speed);
  if (speedSelect.value === value) return;
  if (![...speedSelect.options].some((o) => o.value === value)) {
    speedSelect.append(new Option(`${params.speed}×`, value));
  }
  speedSelect.value = value;
}
$('mute-btn').addEventListener('click', () => {
  state.muted = !state.muted;
  applyMute();
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  e.preventDefault();
  togglePlay();
});

// --- Export --------------------------------------------------------------

function baseName() {
  return (state.sourceName || 'tidskub').replace(/\.[^.]+$/, '') || 'tidskub';
}

function withExportSize(fn) {
  const { width, height } = exportSize();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  return fn();
}

function saveSnapshot() {
  withExportSize(() => {
    tick();
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${baseName()}-tidskub.png`);
    }, 'image/png');
  });
  layout();
}

let exportAbort = null;

async function exportVideo() {
  if (!state.hasVideo || state.exporting || state.building) return;
  const withAudio = params.audio;
  const format = pickMimeType(withAudio) ?? (withAudio ? pickMimeType(false) : null);
  if (!format) {
    setStatus('Webbläsaren kan inte spela in video. Prova Chrome eller Safari.');
    return;
  }

  state.exporting = true;
  panel.setLocked(true);
  const wasLooping = video.loop;
  const wasRate = video.playbackRate;
  let aborted = false;
  let recorder = null;
  exportAbort = () => {
    aborted = true;
    video.pause();
    video.dispatchEvent(new Event('ended'));
  };

  try {
    const { ctx, recording } = ensureAudio();
    await ctx.resume();
    video.pause();
    video.loop = false;
    video.playbackRate = params.speed;
    video.currentTime = 0;
    await waitFor(video, 'seeked');

    withExportSize(() => {});
    const audioTracks = withAudio ? recording.stream.getAudioTracks() : [];
    recorder = new CanvasRecorder(canvas, {
      fps: params.fps,
      videoBitsPerSecond: params.bitrate * 1_000_000,
      audioTracks,
      mimeType: format.mimeType,
    });

    const loops = params.loops;
    const total = video.duration * loops;
    let loopIndex = 0;
    const progress = () => {
      const done = (loopIndex * video.duration + video.currentTime) / total;
      showBusy(`Exporterar… ${Math.round(done * 100)} %`, done, exportAbort);
    };
    video.addEventListener('timeupdate', progress);
    progress();

    const finished = new Promise((resolve) => {
      const onEnded = async () => {
        loopIndex++;
        if (aborted || loopIndex >= loops) {
          video.removeEventListener('ended', onEnded);
          resolve();
          return;
        }
        video.currentTime = 0;
        await waitFor(video, 'seeked');
        video.play();
      };
      video.addEventListener('ended', onEnded);
    });

    recorder.start();
    await video.play();
    await finished;
    video.removeEventListener('timeupdate', progress);
    const blob = await recorder.stop();
    recorder = null;

    if (aborted) {
      setStatus('Exporten avbröts.');
    } else {
      downloadBlob(blob, `${baseName()}-tidskub.${format.ext}`);
      const mb = (blob.size / 1e6).toFixed(1);
      setStatus(`Klar: ${baseName()}-tidskub.${format.ext} (${mb} MB) har laddats ned.`);
    }
  } catch (err) {
    console.error(err);
    setStatus(`Exporten misslyckades: ${err.message}`);
    if (recorder) await recorder.stop();
  } finally {
    exportAbort = null;
    video.loop = wasLooping;
    video.playbackRate = wasRate;
    state.exporting = false;
    hideBusy();
    panel.setLocked(false);
    layout();
    play();
  }
}

// --- Sparade inställningar ------------------------------------------------

function make(tag, props) {
  return Object.assign(document.createElement(tag), props);
}

function renderPresets(row) {
  row.classList.add('presets');
  let presets = loadPresets();

  const select = make('select', { className: 'preset-select' });
  const nameInput = make('input', {
    type: 'text', className: 'preset-name', placeholder: 'Namn', maxLength: 60,
  });
  const saveBtn = make('button', { type: 'button', className: 'btn btn-small', textContent: 'Spara' });
  const deleteBtn = make('button', { type: 'button', className: 'btn btn-small', textContent: 'Ta bort' });
  const codeInput = make('input', {
    type: 'text', className: 'preset-name preset-code', placeholder: 'Kod', spellcheck: false,
  });
  const openBtn = make('button', { type: 'button', className: 'btn btn-small', textContent: 'Öppna' });
  const shareBtn = make('button', {
    type: 'button', className: 'btn btn-small', textContent: 'Skapa kod att dela',
  });
  const status = make('p', { className: 'row-note' });

  const sortedNames = () => Object.keys(presets).sort((a, b) => a.localeCompare(b, 'sv'));

  let panelLocked = false;
  const updateDelete = () => {
    deleteBtn.disabled = panelLocked || !select.value;
  };

  function refreshList(selected = select.value) {
    const names = sortedNames();
    select.textContent = '';
    select.append(make('option', {
      value: '',
      textContent: names.length ? '— välj sparad —' : 'Inget sparat ännu',
    }));
    for (const name of names) select.append(make('option', { value: name, textContent: name }));
    select.value = names.includes(selected) ? selected : '';
    saveBtn.textContent = presets[nameInput.value.trim()] ? 'Skriv över' : 'Spara';
    updateDelete();
  }

  function persist(message) {
    status.textContent = storePresets(presets)
      ? message
      : 'Kunde inte spara — webbläsaren tillåter inte lagring här.';
  }

  let armTimer = 0;
  function armDelete(armed) {
    clearTimeout(armTimer);
    deleteBtn.classList.toggle('is-armed', armed);
    deleteBtn.textContent = armed ? 'Säker?' : 'Ta bort';
    if (armed) armTimer = setTimeout(() => armDelete(false), 3000);
  }

  select.addEventListener('change', () => {
    armDelete(false);
    updateDelete();
    const name = select.value;
    if (!name) return;
    nameInput.value = name;
    applyValues(presets[name]);
    status.textContent = `Hämtade "${name}".`;
    refreshList(name);
  });

  nameInput.addEventListener('input', () => {
    saveBtn.textContent = presets[nameInput.value.trim()] ? 'Skriv över' : 'Spara';
  });

  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || `Inställning ${sortedNames().length + 1}`;
    presets[name] = { ...params };
    nameInput.value = name;
    refreshList(name);
    persist(`Sparade "${name}".`);
  });

  deleteBtn.addEventListener('click', () => {
    const name = select.value;
    if (!name) {
      status.textContent = 'Välj en sparad inställning i listan först.';
      return;
    }
    if (!deleteBtn.classList.contains('is-armed')) {
      armDelete(true);
      return;
    }
    armDelete(false);
    delete presets[name];
    refreshList('');
    persist(`Tog bort "${name}".`);
  });

  shareBtn.addEventListener('click', async () => {
    const code = encodeSettings(params);
    codeInput.value = code;
    codeInput.select();
    const link = `${location.origin}${location.pathname}#k=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = `Kod: ${code} — länken är kopierad.`;
    } catch {
      status.textContent = `Kod: ${code} — kopiera den härifrån.`;
    }
  });

  function openCode() {
    const values = decodeSettings(codeInput.value);
    if (!values) {
      status.textContent = 'Koden känns inte igen. Kontrollera att hela koden kom med.';
      return;
    }
    applyValues(values);
    status.textContent = 'Öppnade inställningarna från koden.';
  }

  openBtn.addEventListener('click', openCode);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openCode();
  });

  row.append(
    make('div', { className: 'preset-row' }),
    make('div', { className: 'preset-row' }),
    make('p', { className: 'preset-label', textContent: 'Dela med en kod' }),
    make('div', { className: 'preset-row' }),
    shareBtn,
    status,
  );
  row.children[0].append(select, deleteBtn);
  row.children[1].append(nameInput, saveBtn);
  row.children[3].append(codeInput, openBtn);

  refreshList();
  return {
    sync: (disabled) => {
      panelLocked = disabled;
      updateDelete();
    },
  };
}

// --- Panel ---------------------------------------------------------------

const noVideo = () => !state.hasVideo;
const volumeUpToDate = () =>
  !!state.builtWith &&
  state.builtWith.frames === params.frames &&
  state.builtWith.size === params.size;

const sections = [
  {
    title: 'Volym',
    accent: '#7fd4c1',
    hint: 'Sammanhanget: lådan som klippet byggs in i, och rummet runt den.',
    items: [
      { type: 'number', key: 'frames', label: 'Bildrutor', min: 2, max: 512, step: 1,
        info: 'Hur många bildrutor ur klippet som staplas i djupled. Fler ger mjukare tidsövergång men tar längre tid att bygga.' },
      { type: 'number', key: 'size', label: 'Upplösning (px)', min: 32, max: 720, step: 1,
        info: 'Upplösningen på varje bildruta i lådan. Högre blir skarpare men kostar minne.' },
      { type: 'note', id: 'volume-info', text: '' },
      // Knappen är öppen så fort ett klipp är laddat: ett bygge som blev fel eller
      // avbröts ska gå att göra om utan att först behöva ändra något reglage.
      { type: 'buttons', buttons: [
        { label: 'Bygg om volym', id: 'rebuild-btn', action: () => buildVolume() },
      ], disabled: () => noVideo() || state.building,
        info: 'Läser om klippet och packar bildrutorna till lådans 3D-textur med värdena ovan.' },
      // Djupet är ett reglage upp till 5; den som vill dra ut lådan längre än så
      // öppnar det fria läget och skriver vad som helst.
      { type: 'range', key: 'depth', label: 'Djup (tid)', min: 0.2, max: 5, step: 0.05,
        visible: () => !ui.depthExpanded,
        info: 'Hur långt lådan dras ut i tidsled. 1 är en kub; högre blir en korridor genom tiden.' },
      { type: 'number', key: 'depth', label: 'Djup (tid)', min: 0.2, max: 200, step: 0.01,
        visible: () => ui.depthExpanded,
        info: 'Fritt djup i tidsled — skriv vad du vill upp till 200.' },
      { type: 'buttons', buttons: [
        { label: 'Utöka djupet…', action: () => { ui.depthExpanded = true; panel.refresh(); } },
      ], visible: () => !ui.depthExpanded },
      { type: 'buttons', buttons: [
        { label: 'Tillbaka till reglaget', action: () => {
          ui.depthExpanded = false;
          if (params.depth > 5) params.depth = 5;
          onParamChange('depth');
        } },
      ], visible: () => ui.depthExpanded },
      // Olika storlek fram och bak gör lådan till en tratt, åt valfritt håll.
      { type: 'range', key: 'sizeFront', label: 'Storlek fram', min: 0.2, max: 3, step: 0.01,
        info: 'Framsidans storlek. Skiljer den sig från Storlek bak blir lådan en tratt, och bilden växer eller krymper genom klippet.' },
      { type: 'range', key: 'sizeBack', label: 'Storlek bak', min: 0.2, max: 3, step: 0.01,
        info: 'Samma som Storlek fram, men för lådans baksida.' },
      { type: 'checkbox', key: 'flipTime', label: 'Vänd tidsriktning',
        info: 'Vänder tiden i lådan, så att klippets slut ligger längst fram.' },
      // Lådans egna kanter och rummet runt den hör ihop med lådan, inte med bilden.
      { type: 'range', key: 'lines', label: 'Kantlinjer', min: 0, max: 1, step: 0.01,
        info: 'Trådramen runt lådan och konturerna kring ögonblicken.' },
      { type: 'range', key: 'edgeGlow', label: 'Kantglöd', min: 0, max: 2, step: 0.01,
        info: 'Ljusskimret längs lådans kanter.' },
      { type: 'color', key: 'background', label: 'Bakgrund',
        info: 'Färgen på rummet runt lådan.' },
    ],
  },
  {
    title: 'Utseende',
    accent: '#c4a6ff',
    hint: 'Helheten inne i lådan: hur bildrutorna vägs ihop och lyser.',
    items: [
      { type: 'select', key: 'content', label: 'Innehåll', options: [
        [0, 'Bild'], [1, 'Rörelse'],
      ], info: 'Bild visar råa bildrutor. Rörelse visar skillnaden mellan bildrutor, så att stillastående faller bort och det som rör sig ritar banor genom lådan.' },
      { type: 'range', key: 'motionGain', label: 'Rörelsekänslighet', min: 1, max: 40, step: 0.5,
        visible: (p) => p.content === 1,
        info: 'Hur mycket små rörelser förstärks i rörelseläget.' },
      { type: 'select', key: 'blend', label: 'Blandning', options: [
        [0, 'Genomskinlig'], [1, 'Adderande'], [2, 'Maxljus'],
      ], info: 'Hur allt längs siktlinjen vägs ihop: som genomskinliga lager, som adderat ljus, eller bara det ljusaste som syns.' },
      { type: 'range', key: 'density', label: 'Densitet', min: 0, max: 10, step: 0.05,
        visible: (p) => p.blend !== 2,
        info: 'Hur tät volymen är. Högre gör lådan mer ogenomskinlig.' },
      { type: 'range', key: 'lumWeight', label: 'Ljusa partier tätare', min: 0, max: 1, step: 0.01,
        info: 'Låter ljusa partier väga tyngre än mörka, så att de tar över i blandningen.' },
      { type: 'range', key: 'shellFront', label: 'Yta fram', min: 0, max: 1, step: 0.01,
        info: 'Hur mycket lådans framsida syns — första bildrutans kanter utsmetade över tid.' },
      { type: 'range', key: 'shellBack', label: 'Yta bak', min: 0, max: 1, step: 0.01,
        info: 'Samma som Yta fram, men för lådans baksida.' },
      { type: 'range', key: 'brightness', label: 'Ljusstyrka', min: 0.2, max: 3, step: 0.01,
        info: 'Ljusstyrkan på allt innehåll i lådan.' },
      { type: 'range', key: 'saturation', label: 'Mättnad', min: 0, max: 2, step: 0.01,
        info: 'Färgmättnaden, från svartvitt till förstärkta färger.' },
      { type: 'range', key: 'glass', label: 'Glasreflex', min: 0, max: 2, step: 0.01,
        info: 'Reflexen som får lådans ytor att skifta som glas när kameran rör sig.' },
      { type: 'range', key: 'steps', label: 'Kvalitet (steg)', min: 48, max: 360, step: 1,
        info: 'Hur många steg strålarna tar genom lådan. Fler ger jämnare bild men tyngre rendering.' },
      { type: 'range', key: 'edgeFade', label: 'Tona in och ut vid ändarna', min: 0, max: 0.5, step: 0.005,
        info: 'Tonar klippets början och slut mot lådans ändar i stället för att de klipps tvärt.' },
    ],
  },
  {
    // Snitten är ögonblicken: bildrutorna som skarpa plan, flera tider samtidigt.
    title: 'Ögonblick',
    accent: '#ffc978',
    hint: 'Bildrutor som skarpa plan i lådan — flera tider samtidigt. En flik per riktning.',
    items: [
      { type: 'tabs',
        tabs: [['time', 'Djupled'], ['x', 'Sidled'], ['y', 'Höjdled']],
        get: () => ui.sliceTab,
        set: (value) => { ui.sliceTab = value; } },

      { type: 'checkbox', key: 'timeOn', label: 'Visa ögonblicken',
        visible: () => ui.sliceTab === 'time',
        info: 'Visar ögonblicken: skarpa bildrutor som plan tvärs genom lådan.' },
      { type: 'range', key: 'timeCount', label: 'Antal', min: 1, max: 256, step: 1,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn,
        info: 'Hur många ögonblick som visas samtidigt, jämnt fördelade genom klippet.' },
      { type: 'range', key: 'timeFull', label: 'Ögonblick med full styrka', min: 1, max: 32, step: 1,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeCount < 2,
        info: 'Hur många ögonblick som lyser för fullt samtidigt, jämnt fördelade över klippet. Styrkan sjunker mellan dem.' },
      { type: 'checkbox', key: 'timeFollow', label: 'Följ uppspelningen',
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn,
        info: 'Låter ögonblicken glida genom lådan i takt med att klippet spelas.' },
      { type: 'range', key: 'timePos', label: 'Position', min: 0, max: 1, step: 0.001,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeFollow,
        info: 'Var i klippet ögonblicket ligger, när det inte följer uppspelningen.' },
      { type: 'range', key: 'timeOpacity', label: 'Opacitet', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn,
        info: 'Styrkan på ögonblicken med full styrka. Hur de tonar av mellan varandra ställs längre ner i fliken.' },
      { type: 'note', text: 'Höj Antal över 1 för fler ögonblick genom lådan — då vaknar mönstret mellan dem.',
        visible: (p) => ui.sliceTab === 'time' && p.timeOn && p.timeCount < 2 },
      { type: 'note', text: 'Hög opacitet gör att det främsta ögonblicket skymmer de bakom — sänk den för att se flera.',
        visible: (p) => ui.sliceTab === 'time' && p.timeOn && p.timeCount >= 2 && p.timeOpacity > 0.5 },

      // Vågen och styrkerampen — mönstret mellan ögonblicken. Vågen ligger i två
      // underflikar; den andra finns bara när det finns fler snitt än ett att tona.
      { type: 'tabs',
        tabs: [
          ['played', 'Bildrutan som spelas'],
          ['slices', 'Övriga ögonblick', (p) => p.timeCount >= 2],
        ],
        get: () => ui.waveTab,
        set: (value) => { ui.waveTab = value; },
        visible: () => ui.sliceTab === 'time' },
      { type: 'range', key: 'wave', label: 'Vågens styrka', min: 0, max: 4, step: 0.01, pane: true,
        visible: () => ui.sliceTab === 'time' && ui.waveTab === 'played',
        info: 'Hur mycket starkare allt nära den spelade bildrutan lyser än resten av klippet. 0 visar allt lika mycket; över 1 skärs det bortanför vågen bort.' },
      { type: 'range', key: 'waveWidth', label: 'Vågens längd', min: 0.02, max: 1, step: 0.01, pane: true,
        visible: () => ui.sliceTab === 'time' && ui.waveTab === 'played', disabled: (p) => p.wave <= 0,
        info: 'Hur stor del av klippet kring den spelade bildrutan som syns tydligt.' },
      { type: 'range', key: 'sliceWave', label: 'Vågens styrka', min: 0, max: 4, step: 0.01, pane: true,
        visible: () => ui.sliceTab === 'time' && ui.waveTab === 'slices', disabled: (p) => !p.timeOn,
        info: 'Samma våg, men för de övriga ögonblicken: de nära uppspelningen lyser starkast.' },
      { type: 'range', key: 'sliceWaveWidth', label: 'Vågens längd', min: 0.02, max: 1, step: 0.01, pane: true,
        visible: () => ui.sliceTab === 'time' && ui.waveTab === 'slices',
        disabled: (p) => !p.timeOn || p.sliceWave <= 0,
        info: 'Hur brett fönstret kring uppspelningen är för de övriga ögonblicken.' },

      // Styrkerampen: fulla ögonblick på en nivå, de emellan på en annan,
      // och bågen går mellan de två.
      { type: 'range', key: 'timeRestOpacity', label: 'Opacitet mellan ögonblicken', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeCount < 2,
        info: 'Var mönstret bottnar mellan de fulla ögonblicken; Opacitet högre upp är topparnas nivå.' },
      { type: 'note', text: 'Ligger opaciteten emellan i nivå med ögonblicken blir rampen platt — sänk den för att få tillbaka bågen.',
        visible: (p) => ui.sliceTab === 'time' && p.timeOn && p.timeCount >= 2
          && p.timeRestOpacity >= p.timeOpacity },
      { type: 'range', key: 'timeCurve', label: 'Bågens form', min: 0.2, max: 5, step: 0.05,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeCount < 2,
        info: 'Kurvan mellan full styrka och botten: låga värden ger breda toppar som nästan möts, höga ger spetsiga toppar.' },

      { type: 'range', key: 'xCount', label: 'Antal', min: 0, max: 256, step: 1,
        visible: () => ui.sliceTab === 'x',
        info: 'Antal snitt i sidled — stående skivor där höjden är rum och djupet är tid.' },
      { type: 'checkbox', key: 'xSweep', label: 'Svep automatiskt',
        visible: () => ui.sliceTab === 'x', disabled: (p) => p.xCount < 1,
        info: 'Låter sidledssnitten vandra fram och tillbaka av sig själva.' },
      { type: 'range', key: 'xPos', label: 'Position', min: 0, max: 1, step: 0.001,
        visible: () => ui.sliceTab === 'x', disabled: (p) => p.xCount < 1 || p.xSweep,
        info: 'Var i sidled snittet ligger.' },
      { type: 'range', key: 'xOpacity', label: 'Opacitet', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'x', disabled: (p) => p.xCount < 1,
        info: 'Hur starkt sidledssnitten syns.' },

      { type: 'range', key: 'yCount', label: 'Antal', min: 0, max: 256, step: 1,
        visible: () => ui.sliceTab === 'y',
        info: 'Antal snitt i höjdled — liggande skivor där bredden är rum och djupet är tid.' },
      { type: 'checkbox', key: 'ySweep', label: 'Svep automatiskt',
        visible: () => ui.sliceTab === 'y', disabled: (p) => p.yCount < 1,
        info: 'Låter höjdledssnitten vandra upp och ner av sig själva.' },
      { type: 'range', key: 'yPos', label: 'Position', min: 0, max: 1, step: 0.001,
        visible: () => ui.sliceTab === 'y', disabled: (p) => p.yCount < 1 || p.ySweep,
        info: 'Var i höjdled snittet ligger.' },
      { type: 'range', key: 'yOpacity', label: 'Opacitet', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'y', disabled: (p) => p.yCount < 1,
        info: 'Hur starkt höjdledssnitten syns.' },
    ],
  },
  {
    title: 'Special',
    accent: '#ff7ad9',
    hint: 'Vrider ögonblicken mot kameravinkeln, så att de står på diagonalen.',
    items: [
      { type: 'checkbox', key: 'special', label: 'Vrid ögonblicken efter kameran',
        info: 'Ögonblicken vrider sig mot kameran när den åker runt lådan. Lådan smalnar av med vinkeln, så varje ögonblick går helt från vägg till vägg.' },
      { type: 'checkbox', key: 'specialReverse', label: 'Motsatt håll',
        disabled: (p) => !p.special,
        info: 'Vrider åt andra hållet i förhållande till kameran.' },
      { type: 'range', key: 'specialAmount', label: 'Hur mycket', min: 0, max: 3, step: 0.01,
        disabled: (p) => !p.special,
        info: 'Hur långt mot kameravinkeln ögonblicken vrids.' },
    ],
  },
  {
    title: 'Kamera',
    accent: '#9ede8a',
    hint: 'Var kameran står och hur den rör sig.',
    items: [
      { type: 'checkbox', key: 'followSlice', label: 'Följ ögonblicket',
        info: 'Kameran åker med ögonblicket genom lådan på konstant avstånd.' },
      { type: 'select', key: 'motion', label: 'Rörelse', options: [
        ['free', 'Fri (mus)'], ['pendulum', 'Pendel'], ['rotate', 'Rotation'],
      ], info: 'Fri styr du själv med mus eller finger; pendel vaggar kameran, rotation åker runt lådan.' },
      { type: 'range', key: 'motionSpeed', label: 'Hastighet', min: 0.05, max: 2, step: 0.01,
        visible: (p) => p.motion !== 'free',
        info: 'Hur fort pendeln eller rotationen går.' },
      { type: 'range', key: 'fov', label: 'Brännvidd (FOV)', min: 12, max: 75, step: 1,
        info: 'Lågt värde ger tele och plattare perspektiv, högt ger vidvinkel och mer djupkänsla.' },
      { type: 'buttons', buttons: [
        { label: 'Återställ vy', action: () => fitCamera() },
      ], info: 'Ställer kameran så att hela lådan precis får plats i bilden.' },
    ],
  },
  {
    title: 'Export',
    accent: '#ff9db1',
    hint: 'Format och kvalitet på filen du laddar ned.',
    items: [
      { type: 'select', key: 'format', label: 'Format', options: [
        ['1080x1080', '1:1 · 1080×1080'],
        ['1080x1350', '4:5 · 1080×1350'],
        ['1080x1920', '9:16 · 1080×1920'],
        ['1920x1080', '16:9 · 1920×1080'],
      ], info: 'Bildförhållandet på filen som exporteras — samma som förhandsvisningen.' },
      { type: 'select', key: 'fps', label: 'Bilder/s', options: [[30, '30'], [60, '60']],
        info: 'Bildfrekvensen i den exporterade filen.' },
      { type: 'select', key: 'bitrate', label: 'Kvalitet', options: [
        [8, '8 Mbit/s'], [16, '16 Mbit/s'], [24, '24 Mbit/s'], [40, '40 Mbit/s'],
      ], info: 'Bithastigheten: högre ger skarpare video men större fil.' },
      { type: 'select', key: 'loops', label: 'Längd', options: [
        [1, '1 varv'], [2, '2 varv'], [3, '3 varv'],
      ], info: 'Hur många varv av klippet som spelas in.' },
      { type: 'checkbox', key: 'audio', label: 'Ta med ljud',
        info: 'Tar med klippets originalljud i den exporterade filen.' },
      { type: 'buttons', buttons: [
        { label: 'Exportera video', id: 'export-btn', primary: true, action: exportVideo },
        { label: 'Spara bild', action: saveSnapshot },
      ], disabled: () => noVideo() || state.building,
        info: 'Exportera video spelar in i realtid och laddar ner som fil; Spara bild tar en stillbild av vyn.' },
      { type: 'note', id: 'export-status',
        text: 'Exporten spelar in i realtid i den hastighet du valt under videon. Håll fliken synlig under tiden.' },
    ],
  },
  {
    title: 'Sparade inställningar',
    accent: '#8fb9ff',
    hint: 'Spara looks du gillar, och dela dem med en kod.',
    items: [{ type: 'custom', render: renderPresets }],
  },
];


// Visar vad de valda inställningarna kostar innan man bygger om.
function volumeEstimate() {
  if (!state.hasVideo || !video.videoWidth) {
    return 'Fler bildrutor ger mjukare tidsövergång men tar längre tid att bygga.';
  }
  const scale = Math.min(1, params.size / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.max(2, Math.round(video.videoWidth * scale));
  const h = Math.max(2, Math.round(video.videoHeight * scale));
  const mb = (w * h * params.frames * 4) / 1e6;
  const fps = video.duration ? ` (${(params.frames / video.duration).toFixed(1)} bildrutor/s av klippet)` : '';
  const cost = `${w}×${h} × ${params.frames} st ≈ ${mb.toFixed(0)} MB${fps}.`;
  if (state.building) return `${cost} Bygger…`;
  if (!state.builtWith) return `${cost} Ingen volym byggd än — tryck Bygg om volym.`;
  if (!volumeUpToDate()) return `${cost} Ändrat sedan bygget — tryck Bygg om volym.`;
  return `${cost} Volymen är byggd så här; bygg om för att göra om den.`;
}

function updateVolumeInfo() {
  const note = $('volume-info');
  if (note) note.textContent = volumeEstimate();
}

// Panelen speglar var volymen står: både knapptillstånd och raden som beskriver bygget.
function syncPanel() {
  updateVolumeInfo();
  panel.refresh();
}

function applyValues(values) {
  Object.assign(params, sanitize(values));
  onParamChange('*');
}

function onParamChange(key) {
  if (key === 'frames' || key === 'size' || key === '*') updateVolumeInfo();
  // Ett stort djup från en kod eller ett förval öppnar det fria läget av sig självt.
  if ((key === 'depth' || key === '*') && params.depth > 5) ui.depthExpanded = true;
  if (key === 'depth' || key === '*') volume.setDepth(params.depth);
  if (key === 'format' || key === '*') layout();
  if (key === 'motion' || key === '*') anchorMotion();
  saveParams();
  panel.refresh();
}

const panel = buildPanel($('panel'), sections, params, DEFAULTS, onParamChange);

// Återställningen kräver två klick, så att inte en felklickning slår ut alla inställningar.
const resetBtn = $('reset-btn');
let resetTimer = 0;
function armReset(armed) {
  clearTimeout(resetTimer);
  resetBtn.classList.toggle('is-armed', armed);
  resetBtn.textContent = armed ? 'Säker?' : 'Återställ';
  if (armed) resetTimer = setTimeout(() => armReset(false), 3000);
}
resetBtn.addEventListener('click', () => {
  if (!resetBtn.classList.contains('is-armed')) {
    armReset(true);
    return;
  }
  armReset(false);
  // Antal bildrutor och upplösning behålls, annars måste volymen byggas om.
  const keep = { frames: params.frames, size: params.size };
  Object.assign(params, DEFAULTS, keep);
  onParamChange('*');
});
volume.setDepth(params.depth);
applyMute();
updateVolumeInfo();

// En länk med #k=<kod> öppnar delade inställningar direkt.
const sharedCode = location.hash.slice(1).replace(/^k=/, '');
if (sharedCode) {
  const shared = decodeSettings(sharedCode);
  if (shared) applyValues(shared);
}

// ?src=url laddar en video direkt (bra för test och länkar).
const srcParam = new URLSearchParams(location.search).get('src');
if (srcParam) {
  state.muted = true;
  applyMute();
  openSource(srcParam, srcParam.split('/').pop());
}

if (import.meta.env.DEV) {
  window.__n4tn = { params, state, camera, controls, volume, video, renderer, fitCamera, openSource, exportVideo };
}
